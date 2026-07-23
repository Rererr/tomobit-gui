import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ChatMessage } from "../types";
import { MessageView } from "./ChatMessageView";

interface ChatPaneProps {
  messages: ChatMessage[];
  onSend: (draft: string) => void;
  // 区切り中は空のままの送信ボタンを許す: 締めのFeedback質問への「Enter=まだ
  // 言えない」をキーボード以外でも実行できるようにする（入力欄の無効化は
  // 質問への回答経路を塞ぐので不可）。
  allowEmptySend: boolean;
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

  return (
    <div className="chat-pane">
      {/* role=log はチャット履歴の標準ARIAパターン。aria-live="assertive" は
          常時流れるトークンストリームをそのたび読み上げて害になるので使わない。
          aria-relevant も既定の "additions text" ではなく "additions" に絞る —
          text を含めると、ストリーミング中に同一ブロックのテキストが伸びるたびに
          再読み上げが走り、実質assertive相当のうるささになる。additions限定なら
          新規ノードの出現だけを知らせ、ノード内のテキスト継ぎ足しは無視してほしい
          という意図だが、aria-relevantの解釈はAT側の実装依存でサポートが不均一
          （無視されれば既定の"additions text"にフォールバックしうる）— 保証では
          なく期待。全文の読了はブラウズモードでの読み返しに委ねる。 */}
      <div className="chat-log" ref={chatLogRef} onScroll={handleLogScroll} role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 ? (
          <div className="chat-empty-state">Tomoに話しかけてみよう</div>
        ) : (
          messages.map((message) => <MessageView key={message.id} message={message} />)
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
