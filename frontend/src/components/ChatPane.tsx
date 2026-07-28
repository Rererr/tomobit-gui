import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { ChatMessage } from "../types";
import type { Activity } from "../activity";
import { MessageView } from "./ChatMessageView";
import { ActivityIndicator } from "./ActivityIndicator";
import { NewChatConfirmDialog } from "./NewChatConfirmDialog";

interface ChatPaneProps {
  messages: ChatMessage[];
  // 動いているあいだだけ非null (ADR-0008)。null は「待つものが無い＝人の番」。
  activity: Activity | null;
  onSend: (draft: string) => void;
  // 今のチャットを区切って次へ (ADR-0001: New chat = /exit)。押した瞬間には
  // 走らせず、確認モーダルを挟んでから呼ぶ — 区切りは取り消せない。
  onNewChat: () => void;
  // 区切り・締めが既に走っている間は重ねて区切れない。
  newChatDisabled: boolean;
  // 区切り中は空のままの送信ボタンを許す: 締めのFeedback質問への「Enter=まだ
  // 言えない」をキーボード以外でも実行できるようにする（入力欄の無効化は
  // 質問への回答経路を塞ぐので不可）。
  allowEmptySend: boolean;
  // ログと入力欄の間に敷く作業バー (ADR-0004 Decision 4)。配置だけが
  // ChatPane の責務で、中身（設定の読み書き）は親が持つ。
  workspace: ReactNode;
}

// 最下部からこの距離(px)以内なら「追従中」とみなす。ピクセル単位の丸め誤差を
// 吸収する程度の遊び。
const STICK_TO_BOTTOM_THRESHOLD_PX = 80;

export function ChatPane({
  messages,
  activity,
  onSend,
  onNewChat,
  newChatDisabled,
  allowEmptySend,
  workspace,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const [confirmingNewChat, setConfirmingNewChat] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // エフェクトはmessages更新のたびに走るが、追従の可否は直前のスクロール位置
  // （ユーザー操作）で決まる。state読み出しのクロージャ陳腐化を避けるためrefで持つ。
  const stickToBottomRef = useRef(true);

  function setStick(v: boolean) {
    stickToBottomRef.current = v;
    setStickToBottom(v);
  }

  // 最下部への張り付きは、ログ自身のスクロール箱だけを動かして行う。
  //
  // 末尾の番兵divへの scrollIntoView() ではいけない: 既定は block:"start" で、
  // しかも「スクロールできる祖先を全部」動かす。#app は overflow:hidden ——
  // hidden は「人が掴めない」だけで、プログラムからは動く箱である。窓が短くて
  // 格子の中身がはみ出していると、この1行がアプリの外枠ごと上へずり上げ、
  // スクロールバーも無いので二度と戻せなくなっていた（2026-07-29: 三窓目で
  // 送信すると見える範囲が下部だけになる不具合。三窓目なのは、3窓の格子だけが
  // 2行を要求して縦にはみ出しやすく、その2行目が三窓目だから）。
  // scrollTop への代入なら、触るのはこの箱ひとつだけで祖先へ波及しない。
  function scrollLogToBottom() {
    const el = chatLogRef.current;
    if (el === null) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }

  // 追従中の時だけ自動スクロールする: 読み返しで上にスクロールした最中に
  // ストリームの新着で最下部へ引き戻される問題を避ける（実機で確認された挙動）。
  // 実行中の帯 (ADR-0008) もログの高さを変えるので同じ追従に乗せる — 出た瞬間に
  // 画面外へはみ出したのでは、進捗を見せるために置いた帯が見えない。
  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollLogToBottom();
    }
  }, [messages, activity]);

  function handleLogScroll() {
    const el = chatLogRef.current;
    if (el === null) {
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStick(distanceFromBottom < STICK_TO_BOTTOM_THRESHOLD_PX);
  }

  function jumpToBottom() {
    scrollLogToBottom();
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
        {messages.length === 0 && activity === null ? (
          <div className="chat-empty-state">Tomoに話しかけてみよう</div>
        ) : (
          messages.map((message) => <MessageView key={message.id} message={message} />)
        )}
        {/* 進捗が1つも来ないあいだ、動いていることを言う唯一の場所 (ADR-0008)。
            会話の末尾に置くのは、待っている人の目が既にそこにあるから */}
        {activity !== null && <ActivityIndicator activity={activity} />}
      </div>
      {!stickToBottom && (
        <button className="chat-jump-bottom-btn" onClick={jumpToBottom}>
          ↓ 最新へ
        </button>
      )}

      {workspace}

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
        <div className="chat-input-actions">
          <button
            className="chat-newchat-btn"
            onClick={() => setConfirmingNewChat(true)}
            disabled={newChatDisabled}
            title="今のチャットを区切って、新しいチャットを始める"
          >
            New chat
          </button>
          <button
            className="chat-send-btn"
            onClick={submitDraft}
            disabled={draft.trim() === "" && !allowEmptySend}
          >
            {draft.trim() === "" && allowEmptySend ? "まだ言えない" : "送信"}
          </button>
        </div>
      </div>
      {confirmingNewChat && (
        <NewChatConfirmDialog
          onConfirm={() => {
            setConfirmingNewChat(false);
            onNewChat();
            // モーダルへ移ったフォーカスの戻り先。締めの質問へすぐ答えられる。
            textareaRef.current?.focus();
          }}
          onCancel={() => {
            setConfirmingNewChat(false);
            textareaRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
