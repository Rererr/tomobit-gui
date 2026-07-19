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
import type { ChatMessage, PaneId, StreamChannel } from "./types";

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

function App() {
  const [activePane, setActivePane] = useState<PaneId>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [tomoStatus, setTomoStatus] = useState<main.TomoStatus | null>(null);
  const [sessions, setSessions] = useState<main.SessionDigest[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  // New chat が /exit を送ってから完了表示までの「区切り中」。イベント購読は
  // 一度きり(deps [])なので ref で最新値を読み、UI（空送信ボタンの活性化）は
  // state で再描画する — 二重管理は setBoundary に閉じ込める。
  const boundaryRef = useRef(false);
  const [boundaryActive, setBoundaryActive] = useState(false);

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
      setSessionsError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refreshLedgerViews();
    const offOut = EventsOn("chat:out", (data: OutChunkData) => {
      appendStream(data.channel, data.text);
    });
    const offExit = EventsOn("chat:exit", (data: ExitInfoData) => {
      // 異常終了は区切り中でも隠さない: /exit の尾部（Feedback → 知覚）が
      // 失敗したのに「区切った」と言うのはエラーの握り潰しになる。
      const expected = boundaryRef.current;
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
      offOut();
      offExit();
    };
  }, []);

  function appendSystem(text: string) {
    setMessages((prev) => [...prev, { id: createMessageId(), kind: "system", text }]);
  }

  // 届いたチャンクを末尾のTomo吹き出しに継ぎ足す。末尾がTomoでなければ（＝
  // ユーザー送信後の最初のチャンク）新しい吹き出しを開く。ターン終端の
  // フレーミングは無い(ADR-0001)ので、吹き出しの区切りはユーザーの送信だけ。
  function appendStream(channel: StreamChannel, text: string) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last !== undefined && last.kind === "tomo") {
        const segments = [...last.segments];
        const tail = segments[segments.length - 1];
        if (tail !== undefined && tail.channel === channel) {
          segments[segments.length - 1] = { channel, text: tail.text + text };
        } else {
          segments.push({ channel, text });
        }
        return [...prev.slice(0, -1), { ...last, segments }];
      }
      return [...prev, { id: createMessageId(), kind: "tomo", segments: [{ channel, text }] }];
    });
  }

  async function sendLine(line: string) {
    try {
      await SendLine(line);
    } catch (err) {
      appendSystem(`送信に失敗: ${err instanceof Error ? err.message : String(err)}`);
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
      appendSystem(`区切りに失敗: ${err instanceof Error ? err.message : String(err)}`);
      setActivePane("chat");
      return;
    }
    if (started) {
      setBoundary(true);
      // 区切り中も入力は生かす: 直後に届くTomoの締めの質問（Feedback）への答えは
      // この入力欄から送る。代わりに「新しい話はまだ届かない」ことを言葉で伝える
      // （pipe にターン終端のフレーミングが無い以上、確実な合図は完了表示だけ）。
      // この文に完了表示の「区切った」を含めない: 完了を文字列で探す目（人も
      // スクリプトも）が宣言に誤発火する — E2E 実測で踏んだ罠。
      appendSystem("ここまでを区切って次のタスクへ (/exit) — 締めの質問にはそのまま答えられる。新しい話は締めが終わってから");
    }
    setActivePane("chat");
  }

  function handleSend(draft: string) {
    const line = draft.replace(/\r?\n/g, " ");
    if (line.trim() !== "") {
      setMessages((prev) => [...prev, { id: createMessageId(), kind: "user", text: line.trim() }]);
    } else if (boundaryRef.current) {
      // 締めの質問への空回答（=まだ言えない）は吹き出しを作らないが、無痕跡だと
      // 読み返しで「Tomoの自問自答」に見える — 軽い注記だけ残す。
      appendSystem("（まだ言えない — 空のまま回答）");
    }
    void sendLine(line);
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
