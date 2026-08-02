import type { TurnBlock } from "./types";

/**
 * 終わったターンで畳まれた作業の連なり。中身の TurnBlock は 1 つも捨てない —
 * 畳むのは見た目だけで、開けば元の順序のまま全部出る。ターンにつき高々1つ、
 * 必ず末尾に現れる（GUI ADR-0014 Decision 2）。
 */
export interface WorkBlock {
  kind: "work";
  /** 畳まれた元のブロック（tool と tool_result）。ターン内での元の順序を保つ */
  blocks: TurnBlock[];
  /** 畳まれた中の tool 呼び出しの数。要約行の「作業 N件」に使う */
  toolCount: number;
}

export type FoldedBlock = TurnBlock | WorkBlock;

function isWork(block: TurnBlock): boolean {
  return block.kind === "tool" || block.kind === "tool_result";
}

/**
 * ターンが終わった後だけ、作業ログ（tool / tool_result）を1つの WorkBlock へ
 * ターンの末尾に集める。text と error は畳まず、元の順序のまま上に残る
 * （GUI ADR-0014 Decision 2）。
 *
 * なぜ「終わった後だけ」か: 走っている最中の tool 行は、いま何をしているかを
 * 語る唯一のものである（末尾の帯 (ADR-0008) が言えるのは「動いている」ことまでで、
 * 中身は言わない）。走行中に畳むと、待たされている人から進捗が消える。
 * 答えが出た瞬間に初めて、その手順は「読まなくてよいもの」に変わる。
 *
 * なぜ本文を挟んだ作業も1つに合流させるか: 畳む単位はかつて「連続した run」
 * だったため、本文の間に畳まれた行が挟まっていた——答えを前に出すために畳んだ
 * のに、畳んだものが本文を分断していた。単位を「ターン1つ」にすると、
 * 「この本文の後にこの作業をした」という対応は既定の表示から消えるが、開けば
 * 元の順序のまま残る。既定で読めることと、読めることは別（同 Decision 2）。
 *
 * なぜ1件でも畳むか: 畳んだ先は Decision 3 で provider・所要時間・コストと
 * 合流する1本のメタ行になる。件数で経路を分けると、1件だけの作業がメタ行に
 * 辿り着けず、常時チップを畳んだ意味が薄れる。
 *
 * なぜ error は畳まないか: 畳んだものは既定で読まれない。読まれなくてよいのは
 * 手順であって、失敗ではない。
 *
 * なぜ text が無いターンは畳まないか: 畳み込みは「隠した先に読むべき答えが
 * ある」ことと引き換えに成立する。答えが無いターン（ツールだけ走って終わった、
 * 途中で切れた）で畳むと、隠すだけで何も前に出ない。
 *
 * finished が false の間は入力をそのまま返す（同じ配列参照ではなく写しを返す
 * ので、呼び出し側が結果を書き換えても元のブロック列は壊れない）。
 */
export function foldWorkBlocks(blocks: TurnBlock[], finished: boolean): FoldedBlock[] {
  if (!finished || !blocks.some((b) => b.kind === "text")) {
    return [...blocks];
  }
  const body: TurnBlock[] = [];
  const work: TurnBlock[] = [];
  for (const block of blocks) {
    if (isWork(block)) {
      work.push(block);
    } else {
      body.push(block);
    }
  }
  const folded: FoldedBlock[] = [...body];
  if (work.length > 0) {
    folded.push({ kind: "work", blocks: work, toolCount: work.filter((b) => b.kind === "tool").length });
  }
  return folded;
}

/** 畳まれた作業の要約行。開く前に「何件あるか」だけは分かるようにする。 */
export function workSummaryLabel(work: WorkBlock): string {
  // tool_result だけが連なる形（本体が tool を出さずに結果だけ流す経路）では
  // 呼び出し回数を名乗れない。数えられないものを数えたことにしない。
  if (work.toolCount === 0) {
    return `作業の出力 ${work.blocks.length}件`;
  }
  return `作業 ${work.toolCount}件`;
}
