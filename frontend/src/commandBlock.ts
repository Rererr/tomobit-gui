import type { main } from "../wailsjs/go/models";

// チャットのコードフェンスを「実行できるもの」として扱うかの判定と、
// 走らせた結果の言い方 (ADR-0007)。DOM も Wails も触らない純関数だけを置く。

/**
 * 実行ボタンを出すフェンスの言語 (ADR-0007 Decision 2)。
 *
 * 言語指定は書き手の申告であって検証ではない。だからこれは安全機構ではなく、
 * 「これはコマンドのつもりで書いた」という宣言が無い塊を、こちらが勝手に
 * コマンドとみなさないための線引きである。`shell` や `console` を足したく
 * なるが、ADR が名指ししたのはこの3つなので、広げるなら ADR を先に直す。
 */
const RUNNABLE_LANGUAGES = new Set(["sh", "bash", "zsh"]);

/**
 * react-markdown が `<code>` に載せる className（`language-sh` 等）から、
 * 実行ボタンを出すかを決める。言語指定が無いフェンス（className 無し）は false —
 * 申告が無いものを実行可能に見せるのは、こちらが意味を付け足していることになる。
 */
export function isRunnableLanguage(className: string | undefined): boolean {
  if (className === undefined) {
    return false;
  }
  for (const token of className.split(/\s+/)) {
    const m = /^language-(.+)$/.exec(token);
    if (m !== null && RUNNABLE_LANGUAGES.has(m[1].toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * フェンスの中身を、実行に渡す文字列へ整える。末尾の改行だけ落とす —— 中身の
 * 加工はここまでにする。行を選ぶ・コメントを外す・`$` を剥がすといった「親切」は、
 * 確認の帯に出した文字列と実際に走る文字列を食い違わせる（ADR-0007 Decision 3 が
 * 見せると約束しているのは「これから走るコマンドの全文」であって、その要約ではない）。
 */
export function commandFromFence(text: string): string {
  return text.replace(/\n+$/, "");
}

/** 走らせてよい状態か。空白だけのフェンスにボタンを出しても押せる先が無い。 */
export function isRunnable(className: string | undefined, text: string): boolean {
  return isRunnableLanguage(className) && commandFromFence(text).trim() !== "";
}

/** 走った結果の見出し。人が最初に見る1行なので、良し悪しの判定まで含める。 */
export function runResultLabel(run: main.CommandRun): string {
  const secs = `${(run.duration_ms / 1000).toFixed(1)}s`;
  if (run.timed_out) {
    // 時間切れは終了コードを名乗れない。0 でも失敗でもなく、「終わらなかった」。
    return `時間切れで打ち切った ・ ${secs}`;
  }
  if (run.exit_code === 0) {
    return `終了コード 0 ・ ${secs}`;
  }
  if (run.exit_code < 0) {
    // シグナルで死んだ等。終了コードを名乗れないので名乗らない。
    return `終了コードを取れないまま終わった ・ ${secs}`;
  }
  return `終了コード ${run.exit_code} ・ ${secs}`;
}

/** 出力が空だったことは、出力が無かったと言う（空欄で沈黙しない）。 */
export function runOutputIsEmpty(run: main.CommandRun): boolean {
  return run.stdout === "" && run.stderr === "";
}

/** 走らせる場所の言い方。未設定は GUI プロセスの継承先で、パスを名乗れない。 */
export function workingDirLabel(workingDir: string): string {
  return workingDir === "" ? "作業ディレクトリ未設定（GUIを起動した場所）" : workingDir;
}
