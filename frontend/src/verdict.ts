/**
 * 第2層の判定 (本体 ADR-0055) を画面が扱うための、語彙と選べる手の導出。
 *
 * ここが持つのは**形だけ**で、誰を判定できるかは持たない。本体は中断・未終了・
 * 分割の子・amend済みの4つを断るが、その規則を写すと本体とドリフトする
 * （GUI ADR-0005 Decision 2 と、forget/amend が「CLIが唯一の検証者」と決めた
 * のと同じ線）。ボタンは常に出し、断られたら本体の文言をそのまま見せる。
 */

/** いま置かれている判定。"" は「まだ無い」と「取り消した」の両方。 */
export type Verdict = "up" | "down" | "";

/** 本体へ送る語。"clear" は取り消しで、第1層へ戻す。 */
export type VerdictWord = "up" | "down" | "clear";

export interface VerdictAction {
  word: VerdictWord;
  label: string;
  /** いま置かれている判定と同じ手か — ボタンを押下状態で描くため。 */
  active: boolean;
}

/** 一覧に出す印。判定の無いセッションには何も出さない。 */
export function verdictMark(v: string): string {
  if (v === "up") {
    return "👍";
  }
  if (v === "down") {
    return "👎";
  }
  return "";
}

/**
 * いまの判定から、置ける手を並べる。
 *
 * 👍 と 👎 は常に出る（置き換えは1手でできるべきで、いったん取り消させるのは
 * 遠回り）。取り消しは**何か置かれている時だけ**出る — 無いものを取り消す
 * ボタンは、押せてしまうと「押したのに何も起きない」になる。
 */
export function verdictActions(current: string): VerdictAction[] {
  const now: Verdict = current === "up" || current === "down" ? current : "";
  const actions: VerdictAction[] = [
    { word: "up", label: "👍 よかった", active: now === "up" },
    { word: "down", label: "👎 だめだった", active: now === "down" },
  ];
  if (now !== "") {
    actions.push({ word: "clear", label: "取り消す", active: false });
  }
  return actions;
}

/**
 * 判定が導出のどこに効くかの1行。ボタンの下に出して、押した時に何が起きるかを
 * 隠さない（ADR-0053 が再実行の費用を問いに書いたのと同じ理由）。
 *
 * 文面は本体の導出そのままで、GUIが独自に評価を足してはいない —
 * 第2層は `OutcomeWeight` が最初に読む層である。
 */
export const verdictEffectNote =
  "判定はテスト結果や締めの答えより強く効く。取り消せば元の層に戻る";
