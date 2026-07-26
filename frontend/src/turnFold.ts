import type { TurnBlock } from "./types";

/**
 * 終わったターンで畳まれた作業の連なり。中身の TurnBlock は 1 つも捨てない —
 * 畳むのは見た目だけで、開けば元の順序のまま全部出る。
 */
export interface WorkBlock {
  kind: "work";
  /** 畳まれた元のブロック（tool と tool_result の連続）。順序は保つ */
  blocks: TurnBlock[];
  /** 畳まれた中の tool 呼び出しの数。要約行の「作業 N件」に使う */
  toolCount: number;
}

export type FoldedBlock = TurnBlock | WorkBlock;

function isWork(block: TurnBlock): boolean {
  return block.kind === "tool" || block.kind === "tool_result";
}

/**
 * ターンが終わった後だけ、作業ログ（tool / tool_result の連続）を 1 つの
 * WorkBlock へ畳む。text と error は畳まない。
 *
 * なぜ「終わった後だけ」か: 走っている最中の tool 行は、いま何をしているかを
 * 語る唯一のものである（末尾の帯 (ADR-0008) が言えるのは「動いている」ことまでで、
 * 中身は言わない）。走行中に畳むと、待たされている人から進捗が消える。
 * 答えが出た瞬間に初めて、その手順は「読まなくてよいもの」に変わる。
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
  const folded: FoldedBlock[] = [];
  let run: TurnBlock[] = [];

  function flush() {
    if (run.length === 0) {
      return;
    }
    // 1 件だけの作業をわざわざ畳むと、開く手間の方が高くつく（「作業 1件」を
    // 開いたら 1 行だった、という体験になる）。そのまま出す。
    if (run.length === 1) {
      folded.push(run[0]);
    } else {
      folded.push({ kind: "work", blocks: run, toolCount: run.filter((b) => b.kind === "tool").length });
    }
    run = [];
  }

  for (const block of blocks) {
    if (isWork(block)) {
      run.push(block);
      continue;
    }
    flush();
    folded.push(block);
  }
  flush();
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
