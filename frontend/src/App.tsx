import { useState } from "react";
import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { ChatPane } from "./components/ChatPane";
import { PlaceholderPane } from "./components/PlaceholderPane";
import { SendTurn } from "../wailsjs/go/main/App";
import type { ChatMessage, PaneId } from "./types";

let nextMessageId = 0;

function createMessageId(): string {
  nextMessageId += 1;
  return `msg-${nextMessageId}`;
}

function App() {
  const [activePane, setActivePane] = useState<PaneId>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  function handleNewChat() {
    setMessages([]);
    setActivePane("chat");
  }

  async function handleSend(text: string) {
    setMessages((prev) => [...prev, { id: createMessageId(), role: "user", text }]);
    setSending(true);
    try {
      const reply = await SendTurn(text);
      setMessages((prev) => [...prev, { id: createMessageId(), role: "tomo", text: reply.text }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { id: createMessageId(), role: "tomo", text: `エラー: ${message}` }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div id="app">
      <Sidebar activePane={activePane} onNewChat={handleNewChat} onSelectPane={setActivePane} />
      <main className="main-pane">
        {activePane === "chat" && <ChatPane messages={messages} sending={sending} onSend={handleSend} />}
        {activePane === "settings" && <PlaceholderPane title="設定" />}
        {activePane === "memory" && <PlaceholderPane title="メモリ" />}
      </main>
    </div>
  );
}

export default App;
