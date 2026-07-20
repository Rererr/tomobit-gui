import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ChatMessage, TurnBlock, TurnMessage } from "../types";

interface ChatPaneProps {
  messages: ChatMessage[];
  onSend: (draft: string) => void;
  // 区切り中は空のままの送信ボタンを許す: 締めのFeedback質問への「Enter=まだ
  // 言えない」をキーボード以外でも実行できるようにする（入力欄の無効化は
  // 質問への回答経路を塞ぐので不可）。
  allowEmptySend: boolean;
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function renderBlock(block: TurnBlock, key: number) {
  switch (block.kind) {
    case "text":
      return (
        <p key={key} className="chat-turn-text">
          {block.text}
        </p>
      );
    case "tool":
      return (
        <div key={key} className="chat-turn-tool">
          {block.detail !== undefined ? `${block.name} · ${block.detail}` : block.name}
        </div>
      );
    case "tool_result":
      // 既定折り畳み: 本体は無加工・上限なしで流す（表示予算は消費者=GUIの責務、
      // 本体 ADR-0032）。開いた時だけ全文をスクロール領域に見せる。
      return (
        <details key={key} className="chat-turn-tool-result">
          <summary>ツール出力</summary>
          <pre className="chat-turn-tool-result-body">{block.text}</pre>
        </details>
      );
    case "error":
      return (
        <div key={key} className="chat-turn-error">
          {block.message}
        </div>
      );
  }
}

function renderTurn(message: TurnMessage) {
  return (
    <div key={message.id} className="chat-message chat-message--tomo">
      <span className="chat-message-role">Tomo</span>
      <div className="chat-turn-blocks">{message.blocks.map((block, i) => renderBlock(block, i))}</div>
      {message.finished !== undefined && (
        <div className="chat-turn-footer">
          {formatDuration(message.finished.durationMs)}
          {message.finished.costUsd !== undefined && ` · $${message.finished.costUsd.toFixed(4)}`}
        </div>
      )}
    </div>
  );
}

export function ChatPane({ messages, onSend, allowEmptySend }: ChatPaneProps) {
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
      // IME変換確定のEnterでは送信しない。WebKit(Wails/macOS)はcompositionendが
      // keydownより先に発火しisComposingがfalseになるため、keyCode 229も併せて見る
      // (compositionイベントのフラグ管理では防げない)。
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        return;
      }
      event.preventDefault();
      submitDraft();
    }
  }

  function renderMessage(message: ChatMessage) {
    switch (message.kind) {
      case "user":
        return (
          <div key={message.id} className="chat-message chat-message--user">
            <span className="chat-message-role">You</span>
            <p className="chat-message-text">{message.text}</p>
          </div>
        );
      case "turn":
        return renderTurn(message);
      case "note":
        return (
          <div
            key={message.id}
            className={message.await ? "chat-message--note chat-message--note-await" : "chat-message--note"}
          >
            {message.text}
          </div>
        );
      case "system":
        return (
          <div key={message.id} className="chat-message--system">
            {message.text}
          </div>
        );
      case "stderr":
        return (
          <div key={message.id} className="chat-message--stderr">
            {message.text}
          </div>
        );
    }
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
        <button
          className="chat-send-btn"
          onClick={submitDraft}
          disabled={draft.trim() === "" && !allowEmptySend}
        >
          {draft.trim() === "" && allowEmptySend ? "まだ言えない" : "送信"}
        </button>
      </div>
    </div>
  );
}
