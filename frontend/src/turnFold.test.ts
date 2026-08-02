import test from "node:test";
import assert from "node:assert/strict";
import { foldWorkBlocks, workSummaryLabel } from "./turnFold.ts";
import type { WorkBlock } from "./turnFold.ts";
import type { TurnBlock } from "./types.ts";

const text = (t: string): TurnBlock => ({ kind: "text", text: t });
const tool = (n: string): TurnBlock => ({ kind: "tool", name: n });
const result = (t: string): TurnBlock => ({ kind: "tool_result", text: t });
const error = (m: string): TurnBlock => ({ kind: "error", message: m });

test("走っている間は畳まない（進捗が消えるのを防ぐ）", () => {
  const blocks = [tool("Read"), result("ok"), tool("Edit"), result("ok"), text("できた")];
  assert.deepEqual(foldWorkBlocks(blocks, false), blocks);
});

test("終わったら、作業をターンの末尾へ1つに畳む", () => {
  const folded = foldWorkBlocks([tool("Read"), result("ok"), tool("Edit"), result("ok"), text("できた")], true);
  assert.equal(folded.length, 2);
  // text が上、work が末尾（本文が作業より先に来る順序に揃える）
  assert.deepEqual(folded[0], text("できた"));
  const work = folded[1] as WorkBlock;
  assert.equal(work.kind, "work");
  assert.equal(work.toolCount, 2);
  assert.equal(work.blocks.length, 4);
});

test("畳んでも中身は1つも捨てない（順序も保つ）", () => {
  const blocks = [tool("A"), result("1"), tool("B"), result("2"), text("done")];
  const folded = foldWorkBlocks(blocks, true);
  const work = folded[folded.length - 1] as WorkBlock;
  assert.deepEqual(work.blocks, blocks.slice(0, 4));
});

test("本文を挟んでも、作業はターンの末尾へ1本に集める（GUI ADR-0014 Decision 2）", () => {
  const folded = foldWorkBlocks(
    [tool("A"), result("1"), text("まず調べた"), tool("B"), result("2"), text("直した")],
    true,
  );
  // text は元の順序のまま上に連続し、tool/tool_result は順序を保ったまま
  // 末尾の1つの WorkBlock へ合流する（もう「別々の塊」にはしない）
  assert.deepEqual(
    folded.map((b) => b.kind),
    ["text", "text", "work"],
  );
  assert.deepEqual(folded[0], text("まず調べた"));
  assert.deepEqual(folded[1], text("直した"));
  const work = folded[2] as WorkBlock;
  assert.equal(work.toolCount, 2);
  assert.deepEqual(work.blocks, [tool("A"), result("1"), tool("B"), result("2")]);
});

test("エラーは畳まない（読まれなくてよいのは手順であって失敗ではない）", () => {
  const folded = foldWorkBlocks([tool("A"), result("1"), error("失敗した"), tool("B"), result("2"), text("done")], true);
  assert.deepEqual(
    folded.map((b) => b.kind),
    ["error", "text", "work"],
  );
});

test("本文が無いターンは畳まない（隠すだけで何も前に出ない）", () => {
  const blocks = [tool("A"), result("1"), tool("B"), result("2")];
  assert.deepEqual(foldWorkBlocks(blocks, true), blocks);
});

test("作業が1件でも畳む（メタ1行へ合流するので単独表示の経路を残さない、GUI ADR-0014 Decision 2/3）", () => {
  const folded = foldWorkBlocks([tool("A"), text("done")], true);
  assert.deepEqual(
    folded.map((b) => b.kind),
    ["text", "work"],
  );
  const work = folded[1] as WorkBlock;
  assert.equal(work.toolCount, 1);
  assert.deepEqual(work.blocks, [tool("A")]);
});

test("空のブロック列でも壊れない", () => {
  assert.deepEqual(foldWorkBlocks([], true), []);
  assert.deepEqual(foldWorkBlocks([], false), []);
});

test("返り値は写しで、元のブロック列を壊さない", () => {
  const blocks = [text("a")];
  const folded = foldWorkBlocks(blocks, false);
  folded.push(text("b"));
  assert.equal(blocks.length, 1);
});

test("要約行は数えられたものだけを名乗る", () => {
  assert.equal(workSummaryLabel({ kind: "work", blocks: [tool("A"), result("1")], toolCount: 1 }), "作業 1件");
  // tool を伴わず結果だけが連なる経路では、呼び出し回数を発明しない
  assert.equal(
    workSummaryLabel({ kind: "work", blocks: [result("1"), result("2")], toolCount: 0 }),
    "作業の出力 2件",
  );
});
