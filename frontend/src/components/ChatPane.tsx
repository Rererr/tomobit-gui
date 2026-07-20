import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ChatMessage, TurnBlock, TurnMessage } from "../types";
import { Markdown } from "./Markdown";

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
        <div key={key} className="chat-turn-text">
          <Markdown text={block.text} />
        </div>
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
      {message.blocks.length === 0 && message.finished === undefined ? (
        // turn.started は届いたが最初のブロックがまだ無い間の空白。無反応に
        // 見えないよう、考え中であることだけ示す（内容は先取りしない）。
        <div className="chat-turn-thinking" aria-label="考え中">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="chat-turn-blocks">{message.blocks.map((block, i) => renderBlock(block, i))}</div>
      )}
      {message.finished !== undefined && (
        <div className="chat-turn-footer">
          {formatDuration(message.finished.durationMs)}
          {message.finished.costUsd !== undefined && ` · $${message.finished.costUsd.toFixed(4)}`}
        </div>
      )}
    </div>
  );
}

// 最下部からこの距離(px)以内なら「追従中」とみなす。ピクセル単位の丸め誤差を
// 吸収する程度の遊び。
const STICK_TO_BOTTOM_THRESHOLD_PX = 80;

export function ChatPane({ messages, onSend, allowEmptySend }: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const [stickToBottom, setStickToBottom] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // エフェクトはmessages更新のたびに走るが、追従の可否は直前のスクロール位置
  // （ユーザー操作）で決まる。state読み出しのクロージャ陳腐化を避けるためrefで持つ。
  const stickToBottomRef = useRef(true);

  function setStick(v: boolean) {
    stickToBottomRef.current = v;
    setStickToBottom(v);
  }

  // 追従中の時だけ自動スクロールする: 読み返しで上にスクロールした最中に
  // ストリームの新着で最下部へ引き戻される問題を避ける（実機で確認された挙動）。
  useEffect(() => {
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView();
    }
  }, [messages]);

  function handleLogScroll() {
    const el = chatLogRef.current;
    if (el === null) {
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStick(distanceFromBottom < STICK_TO_BOTTOM_THRESHOLD_PX);
  }

  function jumpToBottom() {
    bottomRef.current?.scrollIntoView();
    setStick(true);
  }

  // 空のままの送信も通す: 区切りのFeedback質問は「Enter=まだ言えない」を
  // 受け付ける(本体と同じ挙動)。通常時の空行はchat側が読み飛ばすので無害。
  function submitDraft() {
    onSend(draft);
    setDraft("");
    // 読み返しで上にスクロールしていても、自分が送信した以上は追従を再開する
    // — 送信は「会話に戻る」という能動的な合図。
    setStick(true);
    // 送信ボタンのマウスクリックはフォーカスをボタンへ奪う（Enter送信では
    // 起きない）。次の一言をすぐ打てるよう入力欄へ戻す。
    textareaRef.current?.focus();
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
      <div className="chat-log" ref={chatLogRef} onScroll={handleLogScroll}>
        {messages.length === 0 ? (
          <div className="chat-empty-state">Tomoに話しかけてみよう</div>
        ) : (
          messages.map(renderMessage)
        )}
        <div ref={bottomRef} />
      </div>
      {!stickToBottom && (
        <button className="chat-jump-bottom-btn" onClick={jumpToBottom}>
          ↓ 最新へ
        </button>
      )}

      <div className="chat-input-bar">
        <textarea
          ref={textareaRef}
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
