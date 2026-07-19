import { useEffect, useState } from "react";
import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { ChatPane } from "./components/ChatPane";
import { PlaceholderPane } from "./components/PlaceholderPane";
import { SendLine } from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
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

  useEffect(() => {
    const offOut = EventsOn("chat:out", (data: OutChunkData) => {
      appendStream(data.channel, data.text);
    });
    const offExit = EventsOn("chat:exit", (data: ExitInfoData) => {
      appendSystem(
        data.error === ""
          ? "チャットのプロセスが終了した — 次の送信で再開する"
          : `チャットのプロセスが異常終了した: ${data.error} — 次の送信で再開する`,
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

  // 「New chat」= /new (ADR-0001 Decision 1)。ログは消さない: 区切りの尾部
  // (Feedback → 知覚 → Tomo)がこの直後にストリームで届くので、消すと会話の
  // 締めくくりごと見えなくなる。
  function handleNewChat() {
    appendSystem("ここまでを区切って次のタスクへ (/new)");
    void sendLine("/new");
    setActivePane("chat");
  }

  function handleSend(draft: string) {
    const line = draft.replace(/\r?\n/g, " ");
    if (line.trim() !== "") {
      setMessages((prev) => [...prev, { id: createMessageId(), kind: "user", text: line.trim() }]);
    }
    void sendLine(line);
  }

  return (
    <div id="app">
      <Sidebar activePane={activePane} onNewChat={handleNewChat} onSelectPane={setActivePane} />
      <main className="main-pane">
        {activePane === "chat" && <ChatPane messages={messages} onSend={handleSend} />}
        {activePane === "settings" && <PlaceholderPane title="設定" />}
        {activePane === "memory" && <PlaceholderPane title="メモリ" />}
      </main>
    </div>
  );
}

export default App;
