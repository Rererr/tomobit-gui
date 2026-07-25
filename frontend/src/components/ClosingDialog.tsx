import { useEffect, useRef, useState } from "react";
import type { BoundaryQuestion } from "../boundaryChoices";

interface ClosingDialogProps {
  /** 今答えるべき問い。null は「器官が走っている最中で、まだ問いが来ていない」 */
  question: BoundaryQuestion | null;
  /** 締めの途中で本体が喋った行（Tomoの一言・知覚の報告など）。古い順 */
  notes: string[];
  onAnswer: (send: string) => void;
  onAbandon: () => void;
}

/**
 * 窓を閉じる前の締め (ADR-0005 Decision 2)。×を押してから閉じるまでの
 * 待ち時間の正体 — 本体が Feedback → 知覚 → 質問 → 鏡 を走らせている —
 * を凍った窓の裏に隠さず、答えられる形で前に出す。
 *
 * 選択肢は本体が流してきた行から読む（boundaryChoices）。GUI は語彙を持たない。
 */
export function ClosingDialog({ question, notes, onAnswer, onAbandon }: ClosingDialogProps) {
  const [answering, setAnswering] = useState(false);
  const [freeText, setFreeText] = useState("");
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const freeTextRef = useRef<HTMLTextAreaElement>(null);

  // 新しい問いが出るたび、押せるものへフォーカスを置く。連打で次の問いへ
  // 答えてしまわないよう、answering の間はボタンを出さない（下記）。
  useEffect(() => {
    if (question === null) {
      return;
    }
    setAnswering(false);
    setFreeText("");
    if (question.choices.length > 0) {
      firstChoiceRef.current?.focus();
    } else {
      freeTextRef.current?.focus();
    }
  }, [question]);

  function answer(send: string) {
    setAnswering(true);
    onAnswer(send);
  }

  const waiting = question === null || answering;

  return (
    // Escでは閉じない: 締めから逃げる道は「待たずに閉じる」1つだけにして、
    // 取り消せない選択（知覚を捨てる）をキー1つの誤爆から遠ざける。
    <div className="closing-backdrop" role="dialog" aria-modal="true" aria-label="閉じる前の締め">
      <div className="closing-dialog">
        <h2 className="closing-title">ここまでを区切っている</h2>
        <p className="closing-lead">
          締めの質問に答えると閉じる。答えは台帳に積まれて、次のTomoになる。
        </p>

        {notes.length > 0 && (
          <div className="closing-notes">
            {notes.map((note, i) => (
              <p key={i} className="closing-note">
                {note}
              </p>
            ))}
          </div>
        )}

        {waiting ? (
          <p className="closing-waiting">Tomoが今回を振り返っている…</p>
        ) : (
          <>
            <p className="closing-question">{question.prompt}</p>
            {question.choices.length > 0 ? (
              <div className="closing-choices">
                {question.choices.map((choice, i) => (
                  <button
                    key={`${choice.send}-${choice.label}`}
                    ref={i === 0 ? firstChoiceRef : undefined}
                    className={`closing-choice${choice.send === "" ? " quiet" : ""}`}
                    onClick={() => answer(choice.send)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            ) : (
              // 角括弧の無い問い（自由記述）にもこの窓の中で答えられるようにする。
              // 器官が増えた日に、ボタンが作れないという理由で答える口ごと
              // 消えるのは避ける。
              <div className="closing-free">
                <textarea
                  ref={freeTextRef}
                  className="closing-free-input"
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  rows={2}
                />
                <button className="closing-choice" onClick={() => answer(freeText.trim())}>
                  送る
                </button>
                <button className="closing-choice quiet" onClick={() => answer("")}>
                  まだ言えない
                </button>
              </div>
            )}
          </>
        )}

        <button className="closing-abandon" onClick={onAbandon}>
          待たずに閉じる（今回の知覚は途中で止まる）
        </button>
      </div>
    </div>
  );
}
