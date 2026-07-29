import type { main } from "../../wailsjs/go/models";
import { runOutputIsEmpty, runResultLabel, workingDirLabel } from "../commandBlock";

// 実行の確認と結果 (ADR-0007 Decision 3・5)。コードブロックの直下に置く
// —— 会話には混ぜない。これは人が自分の手で走らせた結果であって、Tomo の
// ターンの中身ではない（ターンのブロック列に混ぜると畳み込みの入力も
// スクロールバックの形も「本体の view イベントの写し」でなくなる）。
//
// details/summary ではなく専用の帯にしたのは、開いた状態が「まだ走っていない」
// ことを画面で語る必要があるため。details の三角は開閉しか語らない。

interface RunCommandStripProps {
  command: string;
  workingDir: string;
  confirming: boolean;
  running: boolean;
  result: main.CommandRun | null;
  error: string | null;
  onRun: () => void;
  onCancel: () => void;
  onDismissResult: () => void;
}

export function RunCommandStrip({
  command,
  workingDir,
  confirming,
  running,
  result,
  error,
  onRun,
  onCancel,
  onDismissResult,
}: RunCommandStripProps) {
  return (
    <>
      {confirming && (
        <div className="md-run-confirm" role="group" aria-label="コマンドの実行を確認する">
          <p className="md-run-confirm-lead">これを実行する:</p>
          {/* 全文を出す。省略も要約もしない — 帯が見せると約束しているのは
              「これから走るコマンドの全文」であって、その要約ではない */}
          <pre className="md-run-confirm-command">{command}</pre>
          <p className="md-run-confirm-where">
            場所: <span className="md-run-confirm-dir">{workingDirLabel(workingDir)}</span>
          </p>
          <div className="md-run-confirm-actions">
            <button className="md-run-go-btn" onClick={onRun} disabled={running}>
              {running ? "実行中…" : "実行"}
            </button>
            <button className="md-run-cancel-btn" onClick={onCancel} disabled={running}>
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* DOM 上は chat-log (aria-live="polite" aria-relevant="additions") の
          中だが、あちらが知らせるのは新規ノードの出現だけで、実行済みの
          ブロック内に後から現れる完了・失敗はその管理に乗らない。ここで
          別に領域を張る。箱ごと出し入れすると aria-live 属性の付与自体が
          中身の出現と同時になり、読み上げに乗らないことがあるので、箱は
          中身の有無に関わらず常時マウントしておく。 */}
      <div aria-live="polite">
        {error !== null && (
          <div className="md-run-result md-run-result--error">
            <div className="md-run-result-head">
              <span>走らせられなかった: {error}</span>
              <button className="md-run-dismiss-btn" onClick={onDismissResult}>
                閉じる
              </button>
            </div>
          </div>
        )}

        {result !== null && (
          <div
            className={
              result.exit_code === 0 && !result.timed_out
                ? "md-run-result"
                : "md-run-result md-run-result--failed"
            }
          >
            <div className="md-run-result-head">
              <span>{runResultLabel(result)}</span>
              <button className="md-run-dismiss-btn" onClick={onDismissResult}>
                閉じる
              </button>
            </div>
            {/* 出力が無かったことは、空欄で沈黙せずそう言う */}
            {runOutputIsEmpty(result) && <p className="md-run-result-empty">出力は無かった</p>}
            {result.stdout !== "" && <pre className="md-run-result-body">{result.stdout}</pre>}
            {result.stderr !== "" && (
              <pre className="md-run-result-body md-run-result-body--stderr">{result.stderr}</pre>
            )}
            {/* 黙って切り詰めない (ADR-0007 Decision 4) */}
            {result.truncated && (
              <p className="md-run-result-note">出力が長すぎたので、末尾だけ残して切り詰めた</p>
            )}
            {/* 残らないことを先に言う。後から探せると思わせない (Decision 5) */}
            <p className="md-run-result-note">
              この結果は会話にも台帳にも残らない — 画面を離れると消える
            </p>
          </div>
        )}
      </div>
    </>
  );
}
