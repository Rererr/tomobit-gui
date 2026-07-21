import { useEffect, useRef, useState } from "react";
import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { ChatPane } from "./components/ChatPane";
import { SettingsPane } from "./components/SettingsPane";
import { MemoryPane } from "./components/MemoryPane";
import { SessionPane } from "./components/SessionPane";
import { EndTask, GetSessions, GetTomoStatus, SendLine } from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import type { main } from "../wailsjs/go/models";
import type { ChatMessage, PaneId, StreamChannel, TurnBlock } from "./types";
import { asNumber, asString, isViewEvent } from "./types";
import { errorMessage } from "./errorMessage";

let nextMessageId = 0;

function createMessageId(): string {
  nextMessageId += 1;
  return `msg-${nextMessageId}`;
}

interface OutChunkData {
  channel: StreamChannel;
  text: string;
}

interface ExitInfoData {
  error: string;
}

// 連続する text ブロックはひとつに結合する（本体は本文を細切れの text で流す）。
function appendTurnBlock(blocks: TurnBlock[], block: TurnBlock): TurnBlock[] {
  const last = blocks[blocks.length - 1];
  if (block.kind === "text" && last !== undefined && last.kind === "text") {
    return [...blocks.slice(0, -1), { kind: "text", text: last.text + block.text }];
  }
  return [...blocks, block];
}

function App() {
  const [activePane, setActivePane] = useState<PaneId>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [tomoStatus, setTomoStatus] = useState<main.TomoStatus | null>(null);
  const [sessions, setSessions] = useState<main.SessionDigest[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  // 初回読み込み中だけ立てる（以後の再読み込みは既存の一覧を見せたまま裏で
  // 差し替える — 会話中の自動リフレッシュのたびに空表示へ点滅させない）。
  const [sessionsLoading, setSessionsLoading] = useState(true);
  // New chat が /exit を送ってから完了表示までの「区切り中」。イベント購読は
  // 一度きり(deps [])なので ref で最新値を読み、UI（空送信ボタンの活性化）は
  // state で再描画する — 二重管理は setBoundary に閉じ込める。
  const boundaryRef = useRef(false);
  const [boundaryActive, setBoundaryActive] = useState(false);
  // 「New chat が /exit を送った」ことの記憶。chat:exit の完了表示（区切った/
  // 終了した）の判別だけに使う。boundary（空送信の許可）とは寿命が違う —
  // boundary は task.finished（境界の器官が済んだ瞬間）で先に閉じるが、
  // その後に来る chat:exit はまだ「期待された終了」なので別々に持つ。
  const expectedExitRef = useRef(false);
  // 現在開いている Tomo のターン枠の id。turn.started で開き、turn.finished で閉じる。
  // text/tool/tool_result/error はこの id のターンへ追記する（購読は一度きりなので
  // ref で最新の開き枠を追う）。
  const openTurnIdRef = useRef<string | null>(null);

  function setBoundary(v: boolean) {
    boundaryRef.current = v;
    setBoundaryActive(v);
  }

  // ヘッダのステージとセッション一覧は台帳のView。読み直すのは起動時と
  // プロセス終了時（= セッション境界 — 記帳・知覚が走りステージも一覧も
  // 動きうる瞬間）だけ: ポーリングはしない（低負荷、ADR-0001 Decision 3 と
  // 同じ「開くたびに読む」姿勢）。
  async function refreshLedgerViews() {
    try {
      const [status, list] = await Promise.all([GetTomoStatus(), GetSessions()]);
      setTomoStatus(status);
      setSessions(list.sessions);
      setSessionsError(null);
    } catch (err) {
      setSessionsError(errorMessage(err));
    } finally {
      setSessionsLoading(false);
    }
  }

  useEffect(() => {
    void refreshLedgerViews();
    const offView = EventsOn("chat:view", (data: unknown) => {
      handleViewEvent(data);
    });
    // stderr（契約外の人間向け診断）は従来どおりチャンクで届く。
    const offOut = EventsOn("chat:out", (data: OutChunkData) => {
      if (data.channel === "stderr") {
        appendStderr(data.text);
      }
    });
    const offExit = EventsOn("chat:exit", (data: ExitInfoData) => {
      // 異常終了は区切り中でも隠さない: /exit の尾部（Feedback → 知覚）が
      // 失敗したのに「区切った」と言うのはエラーの握り潰しになる。
      const expected = expectedExitRef.current;
      expectedExitRef.current = false;
      setBoundary(false);
      void refreshLedgerViews();
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
      offExit();
    };
  }, []);

  function appendSystem(text: string) {
    setMessages((prev) => [...prev, { id: createMessageId(), kind: "system", text }]);
  }

  // stderr のチャンクを末尾の stderr エントリに継ぎ足す（連続チャンクは1つに結合）。
  function appendStderr(text: string) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last !== undefined && last.kind === "stderr") {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { id: createMessageId(), kind: "stderr", text }];
    });
  }

  // 開いているターンへブロックを追記する。契約上ブロックは turn.started の後にしか
  // 来ないが、万一開き枠が無ければ落とさず新しい枠を開く（n/provider は不明）。
  function appendBlock(block: TurnBlock) {
    const openId = openTurnIdRef.current;
    if (openId === null) {
      const newId = createMessageId();
      openTurnIdRef.current = newId;
      setMessages((prev) => [...prev, { id: newId, kind: "turn", n: 0, provider: "", blocks: [block] }]);
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === openId && m.kind === "turn" ? { ...m, blocks: appendTurnBlock(m.blocks, block) } : m,
      ),
    );
  }

  // chat:view の NDJSON イベントを構造化メッセージへ落とす。未知の type は無視する
  // （本体 ADR-0032 の契約: 消費者は未知の type を無視せよ）。ready/init/provider/
  // task.started は消費してよい（表示しない）。
  function handleViewEvent(raw: unknown) {
    if (!isViewEvent(raw)) {
      return;
    }
    const ev = raw;
    switch (ev.type) {
      case "turn.started": {
        const id = createMessageId();
        openTurnIdRef.current = id;
        const n = asNumber(ev.n) ?? 0;
        const provider = asString(ev.provider) ?? "";
        setMessages((prev) => [...prev, { id, kind: "turn", n, provider, blocks: [] }]);
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
          appendBlock({ kind: "tool_result", text });
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
        // await の note は境界の Feedback 質問 = 入力欄で答える対象なので、空送信
        // （まだ言えない）を許す区切り状態に入れる。
        if (awaiting) {
          setBoundary(true);
        }
        setMessages((prev) => [...prev, { id: createMessageId(), kind: "note", text, await: awaiting }]);
        break;
      }
      case "task.finished":
      case "task.cancelled": {
        // 記帳・知覚が走りステージも一覧も動きうる瞬間。手で /new を打った場合は
        // これだけが台帳更新の合図になる（/exit 経由の refresh は chat:exit に残す）。
        // 境界の器官が済んだので空送信の許可も閉じる — /exit を経ないセッション
        // 境界（手打ちの /new）で「まだ言えない」ボタンが残留しないように。
        setBoundary(false);
        void refreshLedgerViews();
        break;
      }
      default:
        break;
    }
  }

  async function sendLine(line: string) {
    try {
      await SendLine(line);
    } catch (err) {
      appendSystem(`送信に失敗: ${errorMessage(err)}`);
    }
  }

  // 「New chat」= /exit (ADR-0001 追記: 反映境界 = セッション境界 = プロセス
  // 境界)。走行中のプロセスが無ければ区切る対象も無いので、何も起動せず
  // チャット面へ切り替えるだけ。ログは消さない: 区切りの尾部
  // (Feedback → 知覚 → Tomo)がこの直後にストリームで届くので、消すと会話の
  // 締めくくりごと見えなくなる。
  async function handleNewChat() {
    let started: boolean;
    try {
      started = await EndTask();
    } catch (err) {
      appendSystem(`区切りに失敗: ${errorMessage(err)}`);
      setActivePane("chat");
      return;
    }
    if (started) {
      expectedExitRef.current = true;
      setBoundary(true);
      // 区切り中も入力は生かす: 直後に届くTomoの締めの質問（Feedback）への答えは
      // この入力欄から送る。代わりに「新しい話はまだ届かない」ことを言葉で伝える。
      // この文に完了表示の「区切った」を含めない: 完了を文字列で探す目（人も
      // スクリプトも）が宣言に誤発火する — E2E 実測で踏んだ罠。
      appendSystem("ここまでを区切って次のタスクへ (/exit) — 締めの質問にはそのまま答えられる。新しい話は締めが終わってから");
    }
    setActivePane("chat");
  }

  function handleSend(draft: string) {
    // 改行は潰さず保持する: 本体 cooked mode の末尾 `\` 継続でエンコードされ
    // 1ターンに繋ぎ直される（ADR-0032 Decision 2）。エンコードは Go 側の SendLine。
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (boundaryRef.current) {
        // 締めの質問への空回答（=まだ言えない）は吹き出しを作らないが、無痕跡だと
        // 読み返しで「Tomoの自問自答」に見える — 軽い注記だけ残す。
        appendSystem("（まだ言えない — 空のまま回答）");
      }
      void sendLine("");
      return;
    }
    setMessages((prev) => [...prev, { id: createMessageId(), kind: "user", text: trimmed }]);
    void sendLine(trimmed);
  }

  function handleSelectSession(sessionID: string) {
    setSelectedSession(sessionID);
    setActivePane("session");
  }

  return (
    <div id="app">
      <Sidebar
        activePane={activePane}
        sessions={sessions}
        sessionsError={sessionsError}
        sessionsLoading={sessionsLoading}
        selectedSession={selectedSession}
        onNewChat={handleNewChat}
        onSelectPane={setActivePane}
        onSelectSession={handleSelectSession}
      />
      <main className="main-pane">
        {/* Tomo名ヘッダ (ADR-0001 Decision 5): 台帳から導出したテキストView。
            台帳がまだ無ければステージは名乗らない */}
        <header className="main-header" title="成長ステージ — 台帳からの導出View（顔窓と同じ式）">
          {tomoStatus !== null && tomoStatus.exists ? `Tomo · ${tomoStatus.stage_name}` : "Tomo"}
        </header>
        {/* チャットと設定はアンマウントせず隠すだけ: 入力途中の下書き・未保存の
            喋り方編集がペイン切替で消えるのを防ぐ（実機レビューで確認された
            データロス）。メモリと過去セッションは意図的に毎回マウントし直す —
            開くたびに台帳の最新を読み直す方が、黙って古いViewを見せるより正しい */}
        <div style={{ display: activePane === "chat" ? "contents" : "none" }}>
          <ChatPane messages={messages} onSend={handleSend} allowEmptySend={boundaryActive} />
        </div>
        <div style={{ display: activePane === "settings" ? "contents" : "none" }}>
          <SettingsPane />
        </div>
        {activePane === "memory" && <MemoryPane />}
        {activePane === "session" && selectedSession !== null && (
          <SessionPane sessionId={selectedSession} />
        )}
      </main>
    </div>
  );
}

export default App;
