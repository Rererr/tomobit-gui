import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ChatMessage, StreamSegment, TomoMessage } from "../types";

interface ChatPaneProps {
  messages: ChatMessage[];
  onSend: (draft: string) => void;
}

// chatの入力待ちマーカー(" ❯ ")の表示除去。pipe出力は端末向けの素テキスト
// (ADR-0001の受け入れた摩擦)で、マーカーは入力待ちのたびに流れてくる。
// 構造は読まない — 行頭の見た目の掃除だけ。
function stripPromptMarker(text: string): string {
  return text.replace(/^ ❯ /gm, "");
}

// 表示用に整えたセグメント列: マーカーを掃除し、吹き出しの先頭・末尾の
// 余白改行を落とす（中身の空行はそのまま）。
function displaySegments(message: TomoMessage): StreamSegment[] {
  const segments = message.segments.map((seg) => ({ ...seg, text: stripPromptMarker(seg.text) }));
  if (segments.length > 0) {
    const first = segments[0];
    segments[0] = { ...first, text: first.text.replace(/^\n+/, "") };
    const last = segments[segments.length - 1];
    segments[segments.length - 1] = { ...last, text: last.text.replace(/\s+$/, "") };
  }
  return segments.filter((seg) => seg.text !== "");
}

export function ChatPane({ messages, onSend }: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages]);

  // 空のままの送信も通す: 区切りのFeedback質問は「Enter=まだ言えない」を
  // 受け付ける(本体と同じ挙動)。通常時の空行はchat側が読み飛ばすので無害。
  function submitDraft() {
    onSend(draft);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  }

  function renderMessage(message: ChatMessage) {
    if (message.kind === "user") {
      return (
        <div key={message.id} className="chat-message chat-message--user">
          <span className="chat-message-role">You</span>
          <p className="chat-message-text">{message.text}</p>
        </div>
      );
    }
    if (message.kind === "system") {
      return (
        <div key={message.id} className="chat-message--system">
          {message.text}
        </div>
      );
    }
    return (
      <div key={message.id} className="chat-message chat-message--tomo">
        <span className="chat-message-role">Tomo</span>
        <p className="chat-message-text">
          {displaySegments(message).map((seg, i) => (
            <span key={i} className={seg.channel === "stderr" ? "chat-segment--stderr" : undefined}>
              {seg.text}
            </span>
          ))}
        </p>
      </div>
    );
  }

  return (
    <div className="chat-pane">
      <div className="chat-log">
        {messages.length === 0 ? (
          <div className="chat-empty-state">Tomoに話しかけてみよう</div>
        ) : (
          messages.map(renderMessage)
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-bar">
        <textarea
          className="chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tomoにメッセージを送る（Enterで送信 / Shift+Enterで改行）"
          rows={3}
        />
        <button className="chat-send-btn" onClick={submitDraft} disabled={draft.trim() === ""}>
          送信
        </button>
      </div>
    </div>
  );
}
