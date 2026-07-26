import { useState } from "react";
import { SetVerdict } from "../../wailsjs/go/main/App";
import { verdictActions, verdictEffectNote, type VerdictWord } from "../verdict";
import { errorMessage } from "../errorMessage";

interface VerdictBarProps {
  sessionId: string;
  /** いま置かれている判定 ("up" | "down" | "")。 */
  current: string;
  /** 判定が通ったあと、台帳から読み直させる。 */
  onChanged: () => void;
}

/**
 * 過去セッションへの 👍/👎 (本体 ADR-0055 Decision 2)。
 *
 * 第2層は「気が向いた時」の器官なので、常設の問いにはしない — ここは人が
 * 自分でセッションを開いた時にだけ目に入る。「まだ言えない」で閉じた日の
 * 受け皿であり、1週間後に分かったことの置き場である。
 *
 * **誰を判定できるかはここでは決めない。** 中断・未終了・分割の子・amend済みを
 * 断るのは本体で、断り文には「親の <sid> を判定する」「amend --outcome を使う」
 * まで書いてある。ここでその規則を先回りすると本体とドリフトするので、
 * 押させて、返ってきた文言をそのまま出す（forget/amend と同じ姿勢）。
 *
 * 確認ゲートは置かない。forget が二段確認を要るのは不可逆だからで
 * (GUI ADR-0006 / 本体 ADR-0033)、判定は取り消せる。
 */
export function VerdictBar({ sessionId, current, onChanged }: VerdictBarProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function send(word: VerdictWord) {
    setBusy(true);
    setMessage(null);
    SetVerdict(sessionId, word)
      .then((result) => {
        setMessage({ kind: "ok", text: result.summary });
        onChanged();
      })
      .catch((err: unknown) => {
        setMessage({ kind: "error", text: errorMessage(err) });
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <div className="verdict-bar">
      <div className="verdict-actions">
        {verdictActions(current).map((action) => (
          <button
            key={action.word}
            className={`verdict-btn${action.active ? " verdict-btn--active" : ""}`}
            aria-pressed={action.active}
            disabled={busy}
            onClick={() => send(action.word)}
          >
            {action.label}
          </button>
        ))}
      </div>
      <p className="verdict-note">{verdictEffectNote}</p>
      {message !== null && (
        <p className={`verdict-result${message.kind === "error" ? " verdict-result--error" : ""}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
