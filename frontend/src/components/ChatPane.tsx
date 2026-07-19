import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { ChatMessage } from "../types";

interface ChatPaneProps {
  messages: ChatMessage[];
  sending: boolean;
  onSend: (text: string) => void;
}

export function ChatPane({ messages, sending, onSend }: ChatPaneProps) {
  const [draft, setDraft] = useState("");

  function submitDraft() {
    const text = draft.trim();
    if (text === "" || sending) {
      return;
    }
    onSend(text);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  }

  return (
    <div className="chat-pane">
      <div className="chat-log">
        {messages.length === 0 ? (
          <div className="chat-empty-state">Tomoに話しかけてみよう</div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`chat-message chat-message--${message.role}`}>
              <span className="chat-message-role">{message.role === "user" ? "You" : "Tomo"}</span>
              <p className="chat-message-text">{message.text}</p>
            </div>
          ))
        )}
      </div>

      <div className="chat-input-bar">
        <textarea
          className="chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tomoにメッセージを送る"
          rows={3}
        />
        <button className="chat-send-btn" onClick={submitDraft} disabled={sending || draft.trim() === ""}>
          送信
        </button>
      </div>
    </div>
  );
}
