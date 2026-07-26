import { useEffect, useRef, useState } from "react";
import { AbandonBoundary, EndTask, QuitNow, SendLine } from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import type { ChatMessage, DecidedEvent, StreamChannel, TurnBlock } from "./types";
import { asDecidedEvent, asNumber, asString, isViewEvent } from "./types";
import { errorMessage } from "./errorMessage";
import { appendBlocksTo } from "./appendBlocks";
import { budgetToolResult } from "./displayBudget";
import { parseBoundaryQuestion } from "./boundaryChoices";
import type { BoundaryQuestion } from "./boundaryChoices";
import { advanceActivity, startActivity } from "./activity";
import type { Activity, ActivityPhase } from "./activity";

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

/** 送信・区切りに要る操作と、画面が描くのに要る状態。App はこの形だけを見る。 */
export interface ChatSession {
  messages: ChatMessage[];
  activity: Activity | null;
  boundaryActive: boolean;
  closing: boolean;
  closingQuestion: BoundaryQuestion | null;
  closingNotes: string[];
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
  // 到着したブロックの溜め場とフレーム1回のフラッシュ予約 (appendBlocks.ts)。
  const pendingBlocksRef = useRef<TurnBlock[]>([]);
  const flushHandleRef = useRef<number | null>(null);
  // 窓の×が始めた締め (ADR-0005)。
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [closingQuestion, setClosingQuestion] = useState<BoundaryQuestion | null>(null);
  const [closingNotes, setClosingNotes] = useState<string[]>([]);
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

  function flushPendingBlocks() {
    if (flushHandleRef.current !== null) {
      cancelAnimationFrame(flushHandleRef.current);
      flushHandleRef.current = null;
    }
    const pending = pendingBlocksRef.current;
    if (pending.length === 0) {
      return;
    }
    pendingBlocksRef.current = [];
    const openId = openTurnIdRef.current;
    setMessages((prev) => appendBlocksTo(prev, openId, pending));
  }

  function appendBlock(block: TurnBlock) {
    if (openTurnIdRef.current === null) {
      openTurnIdRef.current = createMessageId();
    }
    pendingBlocksRef.current.push(block);
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
        openTurnIdRef.current = id;
        const n = asNumber(ev.n) ?? 0;
        const provider = asString(ev.provider) ?? "";
        const decided = activeDecidedRef.current ?? undefined;
        setMessages((prev) => [...prev, { id, kind: "turn", n, provider, blocks: [], decided }]);
        break;
      }
      case "task.started": {
        const sid = asString(ev.sid);
        activeDecidedRef.current =
          sid !== undefined && pendingDecidedRef.current?.sid === sid ? pendingDecidedRef.current : null;
        pendingDecidedRef.current = null;
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
        flushPendingBlocks();
        const id = openTurnIdRef.current;
        openTurnIdRef.current = null;
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
      case "task.finished":
      case "task.cancelled": {
        setBoundary(false);
        activeDecidedRef.current = null;
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
    // 窓の×が締めを始めた (ADR-0005)。アプリ全体の締めなので宛先を持たない。
    const offClosing = EventsOn("app:closing", () => {
      setClosingMode(true);
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
      ledgerChangeRef.current();
      // 窓を閉じる途中だったなら、締めが終わった今が畳んでよい瞬間
      // (ADR-0009 Decision 4)。アプリ全体の締めなら窓ではなく窓が閉じる。
      exitRef.current();
      if (closingRef.current) {
        void QuitNow();
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

  function abandonBoundary() {
    setClosingMode(false);
    void AbandonBoundary();
  }

  return {
    messages,
    activity,
    boundaryActive,
    closing,
    closingQuestion,
    closingNotes,
    send,
    newChat,
    answerClosing,
    abandonBoundary,
    appendSystem,
    appendStderr,
  };
}
