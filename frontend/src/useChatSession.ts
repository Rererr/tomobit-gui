import { useEffect, useMemo, useRef, useState } from "react";
import { AbandonBoundary, EndTask, SendLine } from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import type { ChatMessage, DecidedEvent, StreamChannel, TurnBlock, TurnMessage } from "./types";
import { asDecidedEvent, asNumber, asReactionEvent, asReactionVocabulary, asString, isViewEvent } from "./types";
import { errorMessage } from "./errorMessage";
import { appendBlocksTo } from "./appendBlocks";
import { SubtaskFrames } from "./subtaskFrames";
import { budgetToolResult } from "./displayBudget";
import { parseBoundaryQuestion } from "./boundaryChoices";
import type { BoundaryQuestion } from "./boundaryChoices";
import { parsePermissionEvent } from "./permission";
import type { PermissionRequest } from "./permission";
import { advanceActivity, startActivity } from "./activity";
import type { Activity, ActivityPhase } from "./activity";
import { drainOutbox, reactionLine, ReactionOutbox, TurnIndex } from "./reaction";
import type { MouthState, ReactionPort, ReactionWord } from "./reaction";
import { applyConfirmedReaction, clearPendingMarks, markTurn, openTurn } from "./reactionMarks";

/**
 * MAIN_PANE は当面ただ一つの窓 (ADR-0009 Phase 1)。定数にしてあるのは、
 * 窓が増える日に「どこが窓を仮定していたか」を grep 一発で見つけられるようにする
 * ため — 空文字や暗黙の既定にしておくと、増やす側が探すものが無くなる。
 */
export const MAIN_PANE = "main";

/** Go 側が全イベントに載せる宛先。窓が2つ以上ある日に、どの会話の出来事かを
 *  推測ではなく事実で決められるようにするための1フィールド。 */
interface PaneAddressed {
  pane: string;
}

interface OutChunkData extends PaneAddressed {
  channel: StreamChannel;
  text: string;
}

interface ExitInfoData extends PaneAddressed {
  error: string;
}

interface ViewEventData extends PaneAddressed {
  event: unknown;
}

/** app:closing の宛先 (ADR-0012 Decision 2)。締めが走り始めた窓だけが載る —
 *  宛先が1つとは限らないので、他のイベントと違って一覧で来る。 */
interface ClosingInfoData {
  panes: string[];
}

/** 送信・区切りに要る操作と、画面が描くのに要る状態。App はこの形だけを見る。 */
export interface ChatSession {
  messages: ChatMessage[];
  activity: Activity | null;
  boundaryActive: boolean;
  closing: boolean;
  /** 締めが終わった（chat:exit が届いた）。closing は立てたまま — 閉じるのは
   *  全部の窓が揃ってからで、それまでこの窓は「済んだ」姿で並ぶ。 */
  closingDone: boolean;
  closingQuestion: BoundaryQuestion | null;
  closingNotes: string[];
  /** Provider が権限を求めている問い (本体 ADR-0053)。null は求められていない。 */
  permission: PermissionRequest | null;
  /** 返答の隣に置く反応の口 (ADR-0014 Decision 4)。窓の中の画面へ context で配る。 */
  reaction: ReactionPort;
  answerPermission: (send: string) => void;
  send: (draft: string) => void;
  newChat: () => Promise<void>;
  answerClosing: (send: string) => void;
  abandonBoundary: () => void;
  appendSystem: (text: string) => void;
  appendStderr: (text: string) => void;
}

let nextMessageId = 0;

function createMessageId(): string {
  nextMessageId += 1;
  return `msg-${nextMessageId}`;
}

/** 置ける枠が1つも無い状態。毎回 new すると context の値が変わって画面が
 *  描き直されるので、空は使い回す。 */
const NO_PLACEABLE_TURNS: ReadonlySet<string> = new Set();

/**
 * useChatSession は「1つの窓ぶんの会話」を丸ごと持つ。
 *
 * ここに集めたものは全て**1本のストリームを前提にした状態**で、App.tsx に直接
 * 置かれていた頃は窓が複数になった瞬間に混ざるものだった（開いているターン枠、
 * 区切り中か、締めの最中か、待ちの段、溜まっているブロック）。窓の数だけこの
 * フックを呼べば、その全部が窓ごとに分かれる。
 *
 * paneId は購読の絞り込みにも使う: Go 側は全イベントに宛先を載せるので、
 * 他の窓の出来事はここで落ちる。
 *
 * onLedgerChange は台帳が動きうる瞬間（境界）の合図。ヘッダ・セッション一覧は
 * Tomo 一匹に属する導出View（ADR-0009 Decision 1）なので、窓ごとには持たず
 * App 側の1つを呼び戻す。
 */
export function useChatSession(
  paneId: string,
  onLedgerChange: () => void,
  onExit: () => void = () => {},
): ChatSession {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 「Tomoが動いている」ことの表示 (ADR-0008)。null は人の番。
  // イベント購読は一度きり(deps [])なので ref で最新を読み、UI は state で描く。
  const activityRef = useRef<Activity | null>(null);
  const [activity, setActivityState] = useState<Activity | null>(null);
  // New chat が /exit を送ってから完了表示までの「区切り中」。
  const boundaryRef = useRef(false);
  const [boundaryActive, setBoundaryActive] = useState(false);
  // 「New chat が /exit を送った」ことの記憶。chat:exit の完了表示の判別だけに使う。
  const expectedExitRef = useRef(false);
  // 現在開いている Tomo のターン枠の id。
  const openTurnIdRef = useRef<string | null>(null);
  // 分割のサブタスクの枠。並走すると同時に複数開くので、ひとつの「いま開いて
  // いる枠」では足りない（本体 ADR-0056 / ADR-0032 の sub）。当て先の規則は
  // 過去の再生（viewFold）と共有する。
  const subFramesRef = useRef(new SubtaskFrames<string>());
  // 到着したブロックの溜め場とフレーム1回のフラッシュ予約 (appendBlocks.ts)。
  // 枠の id ごとに分ける — 並走中は宛先が同時に複数あり、1本の配列に混ぜると
  // 隣の子の本文が自分の枠へ流れ込む。
  const pendingBlocksRef = useRef<Map<string, TurnBlock[]>>(new Map());
  const flushHandleRef = useRef<number | null>(null);
  // 窓の×が始めた締め (ADR-0005)。
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [closingDone, setClosingDone] = useState(false);
  const [closingQuestion, setClosingQuestion] = useState<BoundaryQuestion | null>(null);
  const [closingNotes, setClosingNotes] = useState<string[]>([]);
  // 権限の問い (本体 ADR-0053 Decision 5)。答えるまで出したままにする —
  // 消えると、モデルが「許可をいただけますか」と言ったまま答える口が無い、
  // という ADR-0053 が直そうとした状態にそのまま戻る。
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const permissionRef = useRef<PermissionRequest | null>(null);
  // 反応の語彙は本体が配る (本体 ADR-0057 Decision 3)。null は配られなかった＝
  // 口を出さない — 劣化は沈黙（decided と同じ扱い）。
  const [reactionWords, setReactionWords] = useState<ReactionWord[] | null>(null);
  // いま開いているタスクの「ターン番号 → 枠の id」。台帳の n はタスクごとに
  // 1から振り直されるので、n だけを鍵にすると区切りの向こう側のターンへ印が付く。
  const turnIndexRef = useRef(new TurnIndex<string>());
  // 反応を置ける枠 (ADR-0014 Decision 4)。turnIndexRef の写しだが、描くために
  // state で持つ（activity / boundary と同じ ref+state の二重持ち）。
  const [placeableTurns, setPlaceableTurns] = useState<ReadonlySet<string>>(NO_PLACEABLE_TURNS);
  // 口が空くまで反応を溜める場所。走行中に書いた行は、次に本体が行を読む場所
  // （権限の問い・境界の器官）で答えとして飲まれる (ADR-0014 Decision 4)。
  const outboxRef = useRef(new ReactionOutbox());
  // decided（本体 ADR-0040）は自分の task.started より先に届きうるので一時的に持つ。
  const pendingDecidedRef = useRef<DecidedEvent | null>(null);
  const activeDecidedRef = useRef<DecidedEvent | null>(null);
  // 購読は一度きりなので、最新の呼び先を ref で読む。
  const ledgerChangeRef = useRef(onLedgerChange);
  ledgerChangeRef.current = onLedgerChange;
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  function setBoundary(v: boolean) {
    boundaryRef.current = v;
    setBoundaryActive(v);
  }

  function setActivity(v: Activity | null) {
    activityRef.current = v;
    setActivityState(v);
  }

  // 権限の問いも ref と両持ちにする: 反応を流してよいかの判定は、送信の途中
  // （await のあいだ）にも読み直す必要があり、そこでは state のクロージャが古い。
  function setPermissionAsked(v: PermissionRequest | null) {
    permissionRef.current = v;
    setPermission(v);
  }

  function beginActivity(phase: ActivityPhase) {
    setActivity(startActivity(phase, Date.now()));
  }

  // 区切りの最中に送るものは、次のタスクの依頼ではなく締めの質問への答え。
  function sendingPhase(): ActivityPhase {
    return boundaryRef.current || closingRef.current ? "closing" : "requested";
  }

  function setClosingMode(v: boolean) {
    closingRef.current = v;
    setClosing(v);
  }

  function appendSystem(text: string) {
    setMessages((prev) => [...prev, { id: createMessageId(), kind: "system", text }]);
  }

  function appendStderr(text: string) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last !== undefined && last.kind === "stderr") {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { id: createMessageId(), kind: "stderr", text }];
    });
  }

  /** 反応を送ってよいかの判定に要る、いまの窓の状態（すべて ref から読む）。 */
  function mouthNow(): MouthState {
    return {
      running: activityRef.current !== null,
      permissionAsked: permissionRef.current !== null,
      boundaryActive: boundaryRef.current,
      closing: closingRef.current,
    };
  }

  /** 溜まっている反応を、口が空いているあいだだけ流す (reaction.ts drainOutbox)。 */
  async function flushReactions() {
    await drainOutbox(outboxRef.current, mouthNow, async (n, word) => {
      try {
        // 反応は依頼ではないので、待ちの帯 (ADR-0008) は立てない。sendLine を
        // 通さないのはそのためで、会話にも積まない（押した人が待たされる理由が無い）。
        await SendLine(paneId, reactionLine(n, word));
        return true;
      } catch (err) {
        // 送れなかった印を送信待ちのまま残すと、いつまでも記帳を待つ姿になる。
        setMessages((prev) => markTurn(prev, turnIndexRef.current, n, { reactionPending: undefined }));
        appendSystem(`反応の送信に失敗: ${errorMessage(err)}`);
        return false;
      }
    });
  }

  /**
   * 反応の宛先が消えた（区切り・プロセス終了）。溜めていたものはもう送れない —
   * 本体は走行中のタスクにしか置かせない (本体 ADR-0057 Decision 1)。
   *
   * 黙って捨てないのは、押した人にとっては「置いた」ままだからである。
   *
   * Why not ここで turnIndexRef も捨てるか: 表は次の task.started で捨てられる
   * ので、残るのは「区切りと次のタスクの間」だけである。その間に届きうる唯一の
   * ものは**区切る前に受け付けられた反応の記帳**で、それはそのタスクの枠へ着地
   * するのが正しい（本体は先に sid を空にしてから task.finished を流すので、
   * 区切りの後に読まれた `/react` には記帳を返さない —— 実測: 起動直後の chat は
   * note で断るだけで `reaction` を流さない）。ここで捨てると、その1件だけが
   * 画面から落ち、台帳と食い違う。置ける枠 (placeableTurns) は落とすので、
   * 口はどのみち出ない。
   */
  function dropReactions(reason: string) {
    setPlaceableTurns(NO_PLACEABLE_TURNS);
    // まだ送っていないぶんと、送ったが記帳が返っていないぶんの両方が返る
    // (ReactionOutbox.drop)。後者を数えていないと、**送信は成功したが本体が
    // 断った反応**が 1行も言われずに消える —— 溜め場からは既に抜けているので、
    // 「捨てるものが無かった」と見えるためである。
    const dropped = outboxRef.current.drop();
    // 送信待ちの印は、宛先が消えた時点で全部降ろす（reactionMarks.clearPendingMarks）。
    setMessages(clearPendingMarks);
    if (dropped.length === 0) {
      return;
    }
    appendSystem(`置いた反応は記帳されずに終わった（${reason}）`);
  }

  function flushPendingBlocks() {
    if (flushHandleRef.current !== null) {
      cancelAnimationFrame(flushHandleRef.current);
      flushHandleRef.current = null;
    }
    const pending = pendingBlocksRef.current;
    if (pending.size === 0) {
      return;
    }
    pendingBlocksRef.current = new Map();
    // 枠ごとに1回ずつ流し込む。ひとつのフレームで複数の子が届いても、
    // メッセージ配列の複製は宛先の数だけで、到着件数には比例しない
    // （appendBlocks.ts が直した二次曲線の性質はそのまま保つ）。
    setMessages((prev) => {
      let next = prev;
      for (const [id, blocks] of pending) {
        next = appendBlocksTo(next, id, blocks);
      }
      return next;
    });
  }

  /** この行の宛先の枠 id。無ければ開く（turn.started より先に本文が来た場合）。 */
  function targetTurnId(sub: number | undefined): string {
    if (sub === undefined) {
      if (openTurnIdRef.current === null) {
        openTurnIdRef.current = createMessageId();
      }
      return openTurnIdRef.current;
    }
    const known = subFramesRef.current.target(sub, null);
    if (known !== null) {
      return known;
    }
    const id = createMessageId();
    subFramesRef.current.start(sub, id);
    return id;
  }

  function appendBlock(block: TurnBlock, sub: number | undefined) {
    const id = targetTurnId(sub);
    const buf = pendingBlocksRef.current.get(id);
    if (buf === undefined) {
      pendingBlocksRef.current.set(id, [block]);
    } else {
      buf.push(block);
    }
    if (flushHandleRef.current === null) {
      flushHandleRef.current = requestAnimationFrame(() => {
        flushHandleRef.current = null;
        flushPendingBlocks();
      });
    }
  }

  function handleViewEvent(raw: unknown) {
    if (!isViewEvent(raw)) {
      return;
    }
    const ev = raw;
    // 待ちの段は全イベントを通す (ADR-0008)。
    const nextActivity = advanceActivity(activityRef.current, ev, Date.now());
    if (nextActivity !== activityRef.current) {
      setActivity(nextActivity);
    }
    switch (ev.type) {
      case "turn.started": {
        flushPendingBlocks();
        const id = createMessageId();
        const n = asNumber(ev.n) ?? 0;
        const provider = asString(ev.provider) ?? "";
        const sub = asNumber(ev.sub);
        if (sub !== undefined) {
          subFramesRef.current.start(sub, id);
          const subTotal = asNumber(ev.sub_total);
          setMessages((prev) => [
            ...prev,
            subTotal !== undefined
              ? { id, kind: "turn", n, provider, blocks: [], sub, subTotal }
              : { id, kind: "turn", n, provider, blocks: [], sub },
          ]);
          break;
        }
        openTurnIdRef.current = id;
        const decided = activeDecidedRef.current ?? undefined;
        // 反応の宛先になるのは会話そのもののターンだけ。分割の子は経験を持たない
        // ので（本体 ADR-0054）、置いても効く先が無い (ADR-0014 Decision 4)。
        // 印の引き継ぎは reactionMarks.openTurn が持つ。
        const replaced = turnIndexRef.current.start(n, id);
        const opened: TurnMessage = { id, kind: "turn", n, provider, blocks: [], decided };
        setMessages((prev) => openTurn(prev, opened, replaced));
        setPlaceableTurns(new Set(turnIndexRef.current.refs()));
        break;
      }
      case "task.started": {
        const sid = asString(ev.sid);
        activeDecidedRef.current =
          sid !== undefined && pendingDecidedRef.current?.sid === sid ? pendingDecidedRef.current : null;
        pendingDecidedRef.current = null;
        // 台帳の n はタスクごとに1から振り直される（本体 ADR-0022 Decision 1）。
        // 表を持ち越すと、区切りの向こう側のターンへ印が付く。
        turnIndexRef.current.reset();
        setPlaceableTurns(NO_PLACEABLE_TURNS);
        break;
      }
      case "init": {
        // 語彙は本体が配る (本体 ADR-0057 Decision 3)。プロセスが起き直すたびに
        // 読み直すので、本体を古いものへ戻せば口も黙って消える。
        setReactionWords(asReactionVocabulary(ev));
        break;
      }
      case "reaction": {
        // 押した通りには描かない (ADR-0014 Decision 4 / ADR-0010 Decision 3)。
        // 印が確定するのは、本体が記帳したこの1件を受けた時だけである。
        const r = asReactionEvent(ev);
        if (r !== undefined) {
          // 記帳が返った = もう宙に浮いていない。宛先が判らない番号でも降ろす。
          outboxRef.current.settle(r.n);
          setMessages((prev) => applyConfirmedReaction(prev, turnIndexRef.current, r.n, r.word));
        }
        break;
      }
      case "decided": {
        const decided = asDecidedEvent(ev);
        if (decided !== undefined) {
          pendingDecidedRef.current = decided;
        }
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
        flushPendingBlocks();
        const sub = asNumber(ev.sub);
        let id: string | null;
        if (sub !== undefined) {
          // 閉じるのは自分の枠だけ。並走中は隣の枠がまだ開いている。
          id = subFramesRef.current.finish(sub);
        } else {
          id = openTurnIdRef.current;
          openTurnIdRef.current = null;
        }
        const durationMs = asNumber(ev.duration_ms) ?? 0;
        const costUsd = asNumber(ev.cost_usd);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id && m.kind === "turn"
              ? { ...m, finished: costUsd !== undefined ? { durationMs, costUsd } : { durationMs } }
              : m,
          ),
        );
        break;
      }
      case "note": {
        const text = asString(ev.text);
        if (text === undefined || text === "") {
          break;
        }
        const awaiting = ev.await === true;
        if (awaiting) {
          setBoundary(true);
        }
        if (closingRef.current) {
          if (awaiting) {
            setClosingQuestion(parseBoundaryQuestion(text));
          } else {
            setClosingNotes((prev) => [...prev, text.trim()]);
          }
        }
        setMessages((prev) => [...prev, { id: createMessageId(), kind: "note", text, await: awaiting }]);
        break;
      }
      case "permission": {
        // 文面から種類を当てず、type で判る形で本体が出している。
        const req = parsePermissionEvent(ev as unknown as Record<string, unknown>, parseBoundaryQuestion);
        if (req !== null) {
          setPermissionAsked(req);
        }
        // 読めなかった場合もログには残る（下の note と同じ経路を通らないので、
        // ここで1行積む）— 答える道を完全に消さない。
        const text = asString(ev.text);
        if (req === null && text !== undefined && text !== "") {
          setMessages((prev) => [
            ...prev,
            { id: createMessageId(), kind: "note", text, await: true },
          ]);
          setBoundary(true);
        }
        break;
      }
      case "task.finished":
      case "task.cancelled": {
        setBoundary(false);
        activeDecidedRef.current = null;
        // 区切りの向こう側になったターンには、もう口を出さない
        // (ADR-0014 Decision 4 — あちらの受け皿は過去セッションの 👍/👎)。
        dropReactions("タスクが区切られた");
        ledgerChangeRef.current();
        break;
      }
      default:
        break;
    }
  }

  useEffect(() => {
    // 宛先で絞る (ADR-0009): 他の窓の出来事はこの会話のものではない。
    // 窓が1つの間も同じ経路を通るので、増やす日に配線を変えなくてよい。
    const mine = (data: PaneAddressed | undefined): boolean => data?.pane === paneId;

    const offView = EventsOn("chat:view", (data: ViewEventData) => {
      if (!mine(data)) {
        return;
      }
      handleViewEvent(data.event);
    });
    // stderr（契約外の人間向け診断）は従来どおりチャンクで届く。
    const offOut = EventsOn("chat:out", (data: OutChunkData) => {
      if (!mine(data) || data.channel !== "stderr") {
        return;
      }
      appendStderr(data.text);
    });
    // アプリの×が締めを始めた (ADR-0005)。締めモードに入るのは /exit が届いた
    // 窓だけ (ADR-0012 Decision 2): 載っていない窓はどうせ1枚の裏で、来ない
    // exit を待つ「振り返っている…」を出す理由が無い。
    const offClosing = EventsOn("app:closing", (data: ClosingInfoData) => {
      if (!(data?.panes ?? []).includes(paneId)) {
        return;
      }
      setClosingMode(true);
      setClosingDone(false);
      setClosingQuestion(null);
      setClosingNotes([]);
      setActivity(startActivity("closing", Date.now()));
    });
    const offExit = EventsOn("chat:exit", (data: ExitInfoData) => {
      if (!mine(data)) {
        return;
      }
      flushPendingBlocks();
      const expected = expectedExitRef.current;
      expectedExitRef.current = false;
      setBoundary(false);
      setActivity(null);
      // プロセスが落ちた経路（task.finished を伴わない終わり方）の受け皿。
      // 溜めたまま残すと、次の送信で起き直した別のタスクへ古い番号の反応が飛ぶ。
      dropReactions("チャットのプロセスが終わった");
      ledgerChangeRef.current();
      // 窓を閉じる途中だったなら、締めが終わった今が畳んでよい瞬間
      // (ADR-0009 Decision 4)。
      exitRef.current();
      if (closingRef.current) {
        // アプリを閉じるのはここではない。この窓から見えるのは自分の締めだけで、
        // 隣の窓がまだ答えているかは判らない — 全部揃ったかを知っているのは
        // /exit を送った Go 側だけなので、閉じる判断もそちらに置く
        // (app.go closingPaneExited)。ここで閉じると、最初に終わった窓が
        // 他の窓の知覚を道連れにする。
        // 締めの1枚では、この窓の節が ✓ になる (ADR-0012 Decision 1)。閉じるまで
        // 待たされている事実は、まだ答えている他の節が語る。
        setClosingDone(true);
        // 締めの最中の終了は「区切った」の言い直しなので、ログには積まない。
        return;
      }
      if (data.error !== "") {
        appendSystem(`チャットのプロセスが異常終了した: ${data.error} — 次の送信で再開する`);
        return;
      }
      appendSystem(
        expected
          ? "区切った — 次の送信から新しいチャットが始まる"
          : "チャットのプロセスが終了した — 次の送信で再開する",
      );
    });
    return () => {
      offView();
      offOut();
      offClosing();
      offExit();
      if (flushHandleRef.current !== null) {
        cancelAnimationFrame(flushHandleRef.current);
        flushHandleRef.current = null;
      }
    };
    // paneId はこの窓の一生を通じて変わらない（窓を作り直せば別のフックになる）。
  }, [paneId]);

  async function sendLine(line: string) {
    // 待ちは送る前に立てる: 子プロセスの起動（初回送信）はこの await の中で起きる。
    beginActivity(sendingPhase());
    try {
      await SendLine(paneId, line);
    } catch (err) {
      setActivity(null);
      appendSystem(`送信に失敗: ${errorMessage(err)}`);
    }
  }

  function send(draft: string) {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (boundaryRef.current) {
        appendSystem("（まだ言えない — 空のまま回答）");
      }
      void sendLine("");
      return;
    }
    setMessages((prev) => [...prev, { id: createMessageId(), kind: "user", text: trimmed }]);
    void sendLine(trimmed);
  }

  async function newChat() {
    let started: boolean;
    try {
      started = await EndTask(paneId);
    } catch (err) {
      appendSystem(`区切りに失敗: ${errorMessage(err)}`);
      return;
    }
    if (!started) {
      // 確認モーダルを経て来た操作が黙って何もしないと壊れて見える。区切る
      // 対象が無い＝もう境界の上に居る、をそのまま言う。
      appendSystem("区切る走行中のチャットは無い — 次の送信がそのまま新しいチャットを始める");
      return;
    }
    expectedExitRef.current = true;
    setBoundary(true);
    beginActivity("closing");
    appendSystem(
      "ここまでを区切って次のタスクへ (/exit) — 締めの質問にはそのまま答えられる。新しい話は締めが終わってから",
    );
  }

  function answerClosing(text: string) {
    setClosingQuestion(null);
    void sendLine(text);
  }

  // 許可の答えは普通の1行として本体へ返る（本体が入力欄と同じ口で読んでいる）。
  function answerPermission(text: string) {
    setPermissionAsked(null);
    void sendLine(text);
  }

  /**
   * 返答の隣に反応を置く (ADR-0014 Decision 4)。会話には出さず、待ちの帯も
   * 立てない — `/react` は依頼ではないので、送信欄の履歴にも待ちにも乗らない。
   *
   * ここでやるのは「溜める」ところまでで、送るかどうかは口の状態が決める。
   * 押した瞬間に空いていることもあるので、その場で1度流しにいく（口が空くのを
   * 待つ側は effect が拾うが、押下は view イベントではないので state が動かない）。
   */
  function react(n: number, word: string) {
    if (turnIndexRef.current.target(n) === null) {
      // いまのタスクのターンではない = 宛先が無い。UI はそもそも口を出さない
      // ので普段は起きないが、宛先の判定を持っているのはこちらである。
      return;
    }
    outboxRef.current.place(n, word);
    setMessages((prev) => markTurn(prev, turnIndexRef.current, n, { reactionPending: word }));
    void flushReactions();
  }

  // 押した時の呼び先は毎描画で作り直されるので、context へ配る口は固定にして
  // 中身を ref 越しに読む（ChatPaneHost の answerPortRef と同じ作法）。ここが
  // 毎回変わると、context を読む全ての反応行が毎描画で描き直される。
  const reactRef = useRef(react);
  reactRef.current = react;
  const stableReact = useRef((n: number, word: string) => reactRef.current(n, word)).current;
  const reaction = useMemo<ReactionPort>(
    () => ({ vocabulary: reactionWords, placeable: placeableTurns, react: stableReact }),
    [reactionWords, placeableTurns, stableReact],
  );

  // 口が空いた瞬間に溜めていたものを流す。空いたことは view イベント由来の
  // state 変化で判る（待ちの帯が消えた・問いに答えた・区切りが済んだ）。
  useEffect(() => {
    void flushReactions();
  }, [activity, permission, boundaryActive, closing]);

  // 「待たずに閉じる」(ADR-0005 Decision 3)。締めモードは降ろさない: 放棄は
  // アプリ全体の行為 (ADR-0012 Decision 3) で、押した窓の締めだけが終わった
  // わけではない。降ろすと押した窓の節だけが1枚から消え、残った節が答えを
  // 待ち続ける形になる（実機で観測）— 閉じるまで1枚はそのまま立てておく。
  function abandonBoundary() {
    void AbandonBoundary();
  }

  return {
    messages,
    activity,
    boundaryActive,
    closing,
    closingDone,
    closingQuestion,
    closingNotes,
    permission,
    reaction,
    answerPermission,
    send,
    newChat,
    answerClosing,
    abandonBoundary,
    appendSystem,
    appendStderr,
  };
}
