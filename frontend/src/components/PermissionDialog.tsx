import { useEffect, useRef } from "react";
import type { PermissionRequest } from "../permission";

interface PermissionDialogProps {
  request: PermissionRequest;
  onAnswer: (send: string) => void;
}

/**
 * Provider から来た権限要求の問い (本体 ADR-0053 Decision 5)。
 *
 * GUI は語彙を持たない。何を許すのか（道具の名前）も、選択肢も、問いの文面も、
 * すべて本体が流してきた行から読む — ADR-0005 Decision 2 が締めの質問について
 * 引いた線がそのまま当たる。ここが持つのは「モーダルという形」だけである。
 *
 * ADR-0007（実行ボタン）の作法を継ぐ: **何を許すのかを見せてから許可を取る**。
 * あちらが「走る全文と作業ディレクトリを見せる帯」を開いたのと同じ理由で、
 * ここも道具の名前と、それが触ろうとしたものを並べる。
 *
 * 再実行の費用も隠さない（問いの文面に本体が書いている）。許可はその場で
 * 続行させるものではなく、**やり直させる**もので、トークンはもう一度かかる。
 */
export function PermissionDialog({ request, onAnswer }: PermissionDialogProps) {
  const firstChoiceRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstChoiceRef.current?.focus();
  }, [request]);

  return (
    <div className="permission-backdrop" role="dialog" aria-modal="true" aria-label="権限の確認">
      <div className="permission-dialog">
        <h2 className="permission-title">Tomoが権限を求めている</h2>

        {/* 何を許すのか。detail は本体が summarise した1行で、無いこともある —
            道具の名前だけでも問いとしては成立する（本体 ADR-0053 Decision 3）。 */}
        <ul className="permission-tools">
          {request.tools.map((t, i) => (
            <li key={`${t.tool}-${i}`}>
              <code className="permission-tool-name">{t.tool}</code>
              {t.detail !== "" && <span className="permission-tool-detail">{t.detail}</span>}
            </li>
          ))}
        </ul>

        <p className="permission-prompt">{request.question.prompt}</p>

        <div className="permission-actions">
          {request.question.choices.map((choice, i) => (
            <button
              key={choice.send + choice.label}
              ref={i === 0 ? firstChoiceRef : undefined}
              className={i === 0 ? "permission-btn permission-btn-grant" : "permission-btn"}
              onClick={() => onAnswer(choice.send)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
