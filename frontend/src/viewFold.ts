import type { ChatMessage, DecidedEvent, TurnBlock } from "./types";
// ランタイムの import にだけ拡張子を付けてある。ライブと再生が同じ枠へ印を付ける
// ことを主張する以上、再生側にもテストが要る（ADR-0003 Decision 1: 単一の描画源）
// が、node --test は拡張子無しの相対 import を解決しない — このファイルが
// テストから読めないままだと、規則の共有は「型が通っている」以上を言えない。
import { asDecidedEvent, asNumber, asReactionEvent, asString, isViewEvent } from "./types.ts";
import { budgetToolResult } from "./displayBudget.ts";
import { SubtaskFrames } from "./subtaskFrames.ts";
import { confirmedReaction, TurnIndex } from "./reaction.ts";

// 連続する text ブロックはひとつに結合する（App.tsx appendTurnBlock と同じ規律 —
// 本体は本文を細切れの text で流す）。
function appendTurnBlock(blocks: TurnBlock[], block: TurnBlock): TurnBlock[] {
  const last = blocks[blocks.length - 1];
  if (block.kind === "text" && last !== undefined && last.kind === "text") {
    return [...blocks.slice(0, -1), { kind: "text", text: last.text + block.text }];
  }
  return [...blocks, block];
}

// foldViewEvents は保存済み view イベント列（スクロールバック）を、ライブの
// ChatPane が描くのと同じ ChatMessage[] へ畳む純関数版（ADR-0003 Decision 1:
// 「ライブと同じ構造化描画」）。App.tsx handleViewEvent の逐次・副作用ありの
// リデューサと同じ意味論をバッチで写す — 過去表示は読み取り専用なので ref も
// 境界状態も要らない。
//
// ユーザーのターンは view ストリームに乗らない（本体 cmd/tomobit/chat.go:507 の
// task.started emit は {sid} だけで intent を持たず、task.turn は view へ流れない。
// ライブでは handleSend がローカルに「You」を積んでいた）。そこで userTurnsByN
// （台帳ダイジェストの intent を n で引ける表 — 「何を言ったか」の真実は events 側で、
// 本体は入力を TrimSpace のみの verbatim で intent 記帳する: chat.go:303/484）を
// 受け取り、turn.started の n に合わせて You を差し込む。スクロールバック=Tomo の
// 全文レンダリング、台帳=ユーザーの言葉、の合流で全文を組む（ADR-0001 Decision 2:
// 真実は events を崩さない）。
//
// n の突き合わせが成り立つ根拠（Why-not: 別採番を疑わない）: view の turn.started.n
// と台帳の task.turn.n は本体の同一カウンタ c.turns 由来（chat.go:484 が task.turn へ、
// 1117/1284 が turn.started へ、いずれも c.turns を書く。開始ターンは c.turns=1 で
// digest 側も task.started→n=1）。だから n は両者で一致する契約。fold-back の
// フィードターンは同じ n を繰り返すので emittedUserN で You の二重差し込みを防ぐ。
export function foldViewEvents(rawEvents: unknown[], userTurnsByN: Record<number, string> = {}): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let seq = 0;
  const nextId = () => `sb-${seq++}`;

  // 開いている Tomo のターン枠の index。turn.started で開き turn.finished で閉じる。
  let openTurnIndex = -1;
  // 分割のサブタスクは自分の枠を持つ。並走すると**同時に複数開く**ので、
  // ひとつの「いま開いている枠」では足りない（本体 ADR-0056 で並走が実際に
  // 起きるようになった）。当て先の規則はライブ（useChatSession）と共有する。
  const subFrames = new SubtaskFrames<number>();
  // 反応 (本体 ADR-0057) の宛先を引く表。n はタスクごとに1から振り直されるので
  // task.started でリセットする — 規則はライブ（useChatSession）と同じ1つを通す。
  const turns = new TurnIndex<number>();
  let pendingDecided: DecidedEvent | undefined;
  let activeDecided: DecidedEvent | undefined;
  // n ごとに一度だけ You を差し込む: fold-back のフィードターンは親と同じ n を
  // 繰り返すので、同じユーザー発話を二重に出さない。
  const emittedUserN = new Set<number>();

  /** この行がどの枠に属すか。sub を持たない行は会話そのもののターンへ。 */
  function targetIndex(sub: number | undefined): number {
    return subFrames.target(sub, openTurnIndex) ?? -1;
  }

  /** 置き換えられた枠に付いていた印を、新しい枠へ移す（from が null なら何もしない）。 */
  function carryReactionMark(from: number | null, to: number): void {
    if (from === null) {
      return;
    }
    const old = messages[from];
    const next = messages[to];
    if (old.kind !== "turn" || next.kind !== "turn" || old.reaction === undefined) {
      return;
    }
    next.reaction = old.reaction;
    old.reaction = undefined;
  }

  function appendBlock(block: TurnBlock, sub: number | undefined) {
    const idx = targetIndex(sub);
    if (idx < 0) {
      // 枠が無い行は捨てない — 本文が消えるより、番号だけ持った枠が増える方が
      // 正直である（本体が turn.started を落としても本文は届く）。
      const opened: ChatMessage =
        sub !== undefined
          ? { id: nextId(), kind: "turn", n: 0, provider: "", blocks: [block], sub }
          : { id: nextId(), kind: "turn", n: 0, provider: "", blocks: [block] };
      messages.push(opened);
      if (sub !== undefined) {
        subFrames.start(sub, messages.length - 1);
      } else {
        openTurnIndex = messages.length - 1;
      }
      return;
    }
    const m = messages[idx];
    if (m.kind === "turn") {
      m.blocks = appendTurnBlock(m.blocks, block);
    }
  }

  for (const raw of rawEvents) {
    if (!isViewEvent(raw)) {
      continue;
    }
    const ev = raw;
    switch (ev.type) {
      case "task.started": {
        const sid = asString(ev.sid);
        activeDecided =
          sid !== undefined && pendingDecided?.sid === sid ? pendingDecided : undefined;
        pendingDecided = undefined;
        turns.reset();
        break;
      }
      case "decided": {
        const decided = asDecidedEvent(ev);
        if (decided !== undefined) {
          pendingDecided = decided;
        }
        break;
      }
      case "turn.started": {
        const n = asNumber(ev.n) ?? 0;
        const provider = asString(ev.provider) ?? "";
        const sub = asNumber(ev.sub);
        // この Tomo ターンに対応するユーザー発話を台帳から先に差し込む。
        // サブタスクの枠には差し込まない — あれは人が言ったことではない。
        const intent = userTurnsByN[n];
        if (sub === undefined && intent !== undefined && intent !== "" && !emittedUserN.has(n)) {
          emittedUserN.add(n);
          messages.push({ id: nextId(), kind: "user", text: intent });
        }
        if (sub !== undefined) {
          const subTotal = asNumber(ev.sub_total);
          messages.push(
            subTotal !== undefined
              ? { id: nextId(), kind: "turn", n, provider, blocks: [], sub, subTotal }
              : { id: nextId(), kind: "turn", n, provider, blocks: [], sub },
          );
          subFrames.start(sub, messages.length - 1);
          break;
        }
        messages.push({ id: nextId(), kind: "turn", n, provider, blocks: [], decided: activeDecided });
        openTurnIndex = messages.length - 1;
        // 印の宛先になるのは会話そのもののターンだけ（子は経験を持たない）。
        // 同じ n が繰り返されたら宛先は後から来た枠 —— 畳み戻しの結論が着地する
        // 枠へ印を置く（TurnIndex.start 参照）。前の枠の印はそちらへ移す:
        // 置き換えで消えると、ライブでは見えていた印が再生で消える。
        carryReactionMark(turns.start(n, openTurnIndex), openTurnIndex);
        break;
      }
      case "text": {
        const text = asString(ev.text);
        if (text !== undefined && text !== "") {
          appendBlock({ kind: "text", text }, asNumber(ev.sub));
        }
        break;
      }
      case "tool": {
        const name = asString(ev.name);
        if (name !== undefined) {
          const detail = asString(ev.detail);
          appendBlock(detail !== undefined ? { kind: "tool", name, detail } : { kind: "tool", name }, asNumber(ev.sub));
        }
        break;
      }
      case "tool_result": {
        const text = asString(ev.text);
        if (text !== undefined) {
          // ライブと同じ予算で畳む（ADR-0003 Decision 1: 過去表示はライブと
          // 同じ構造化描画）。ここだけ無制限にすると、過去を開いた瞬間に
          // ライブでは載らない量が載ることになる。
          appendBlock({ kind: "tool_result", text: budgetToolResult(text) }, asNumber(ev.sub));
        }
        break;
      }
      case "error": {
        const message = asString(ev.message);
        if (message !== undefined && message !== "") {
          appendBlock({ kind: "error", message }, asNumber(ev.sub));
        }
        break;
      }
      case "turn.finished": {
        const sub = asNumber(ev.sub);
        const idx = targetIndex(sub);
        if (idx >= 0) {
          const m = messages[idx];
          if (m.kind === "turn") {
            const durationMs = asNumber(ev.duration_ms) ?? 0;
            const costUsd = asNumber(ev.cost_usd);
            m.finished = costUsd !== undefined ? { durationMs, costUsd } : { durationMs };
          }
        }
        // 閉じるのは自分の枠だけ。並走中は隣の枠がまだ開いている。
        if (sub !== undefined) {
          subFrames.finish(sub);
        } else {
          openTurnIndex = -1;
        }
        break;
      }
      case "note": {
        const text = asString(ev.text);
        if (text !== undefined && text !== "") {
          messages.push({ id: nextId(), kind: "note", text, await: ev.await === true });
        }
        break;
      }
      case "reaction": {
        // 過去でも印は見える（置けはしない — GUI ADR-0014 Decision 5）。
        // スクロールバックに残っている記帳の確認をそのまま枠へ写す。
        const r = asReactionEvent(ev);
        if (r === undefined) {
          break;
        }
        const idx = turns.target(r.n);
        if (idx === null) {
          break;
        }
        // 締めが読むのはそのタスクの最後の1件だけ（本体 ADR-0057 Decision 2）。
        // 印もタスクにつき1つにする —— 再生で複数の印が並ぶと、そのタスクが
        // 何と記録されたかについて画面が嘘をつく（ライブと同じ規則: ADR-0003
        // Decision 1）。どこで気が変わったかは台帳のイベント列が持っている。
        for (const other of turns.others(idx)) {
          const m = messages[other];
          if (m.kind === "turn") {
            m.reaction = undefined;
          }
        }
        const m = messages[idx];
        if (m.kind === "turn") {
          m.reaction = confirmedReaction(r.word);
        }
        break;
      }
      default:
        break;
    }
  }
  return messages;
}
