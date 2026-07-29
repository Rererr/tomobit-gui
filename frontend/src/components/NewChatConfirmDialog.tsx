import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { useFocusTrap } from "../useFocusTrap";

interface NewChatConfirmDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * New chat の確認。区切りは取り消せない（/exit を送れば締めが走り始める）ので、
 * 何が起きるかを一言で示してから聞く。見た目は締めのモーダルと同じ型
 * (.closing-*) を使う — どちらも「区切り」の前に立つ層で、別の姿を増やさない。
 */
export function NewChatConfirmDialog({ onConfirm, onCancel }: NewChatConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>();

  // 初期フォーカスは「やめておく」側: 開いた直後の Enter 誤爆が区切りを
  // 走らせない向きに倒す（締めのモーダルが Esc を塞ぐのと同じ姿勢）。
  // preventScroll: true は他2モーダルと同じ理由（focus()自体がスクロールを
  // 引き起こさないようにする）。
  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true });
  }, []);

  // こちらの Esc は取り消しに繋ぐ: まだ何も起きていないので、逃げ道は安全。
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div
      ref={dialogRef}
      className="closing-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="新しいチャットを始める確認"
      onKeyDown={handleKeyDown}
    >
      <div className="closing-dialog">
        <h2 className="closing-title">新しいチャットを始める</h2>
        {/* JSX内の改行は半角スペースに化けて和文に混入するので1行で書く */}
        <p className="closing-lead">今のチャットをここで区切る。Tomoが締めの質問をしたら答えてから、次の送信で新しいチャットが始まる。</p>
        <div className="closing-choices">
          <button className="closing-choice" onClick={onConfirm}>
            区切って始める
          </button>
          <button ref={cancelRef} className="closing-choice quiet" onClick={onCancel}>
            やめておく
          </button>
        </div>
      </div>
    </div>
  );
}
