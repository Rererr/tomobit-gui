import type { ChatMessage, DecidedEvent, TurnBlock } from "./types";
import { asDecidedEvent, asNumber, asString, isViewEvent } from "./types";
import { budgetToolResult } from "./displayBudget";

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
  let pendingDecided: DecidedEvent | undefined;
  let activeDecided: DecidedEvent | undefined;
  // n ごとに一度だけ You を差し込む: fold-back のフィードターンは親と同じ n を
  // 繰り返すので、同じユーザー発話を二重に出さない。
  const emittedUserN = new Set<number>();

  function appendBlock(block: TurnBlock) {
    if (openTurnIndex < 0) {
      messages.push({ id: nextId(), kind: "turn", n: 0, provider: "", blocks: [block] });
      openTurnIndex = messages.length - 1;
      return;
    }
    const m = messages[openTurnIndex];
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
        // この Tomo ターンに対応するユーザー発話を台帳から先に差し込む。
        const intent = userTurnsByN[n];
        if (intent !== undefined && intent !== "" && !emittedUserN.has(n)) {
          emittedUserN.add(n);
          messages.push({ id: nextId(), kind: "user", text: intent });
        }
        messages.push({ id: nextId(), kind: "turn", n, provider, blocks: [], decided: activeDecided });
        openTurnIndex = messages.length - 1;
        break;
      }
      case "text": {
        const text = asString(ev.text);
        if (text !== undefined && text !== "") {
          appendBlock({ kind: "text", text });
        }
        break;
      }
      case "tool": {
        const name = asString(ev.name);
        if (name !== undefined) {
          const detail = asString(ev.detail);
          appendBlock(detail !== undefined ? { kind: "tool", name, detail } : { kind: "tool", name });
        }
        break;
      }
      case "tool_result": {
        const text = asString(ev.text);
        if (text !== undefined) {
          // ライブと同じ予算で畳む（ADR-0003 Decision 1: 過去表示はライブと
          // 同じ構造化描画）。ここだけ無制限にすると、過去を開いた瞬間に
          // ライブでは載らない量が載ることになる。
          appendBlock({ kind: "tool_result", text: budgetToolResult(text) });
        }
        break;
      }
      case "error": {
        const message = asString(ev.message);
        if (message !== undefined && message !== "") {
          appendBlock({ kind: "error", message });
        }
        break;
      }
      case "turn.finished": {
        if (openTurnIndex >= 0) {
          const m = messages[openTurnIndex];
          if (m.kind === "turn") {
            const durationMs = asNumber(ev.duration_ms) ?? 0;
            const costUsd = asNumber(ev.cost_usd);
            m.finished = costUsd !== undefined ? { durationMs, costUsd } : { durationMs };
          }
        }
        openTurnIndex = -1;
        break;
      }
      case "note": {
        const text = asString(ev.text);
        if (text !== undefined && text !== "") {
          messages.push({ id: nextId(), kind: "note", text, await: ev.await === true });
        }
        break;
      }
      default:
        break;
    }
  }
  return messages;
}
