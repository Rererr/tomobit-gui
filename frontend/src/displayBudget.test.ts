import test from "node:test";
import assert from "node:assert/strict";
import { budgetToolResult, toolResultDisplayLimit } from "./displayBudget.ts";

test("上限内なら1文字も触らない（同じ文字列を返す）", () => {
  const s = "ふつうのツール出力\n2行目";
  assert.equal(budgetToolResult(s), s);
  assert.equal(budgetToolResult("x".repeat(toolResultDisplayLimit)), "x".repeat(toolResultDisplayLimit));
});

test("超えたら頭と尻を残し、中略したと名乗る", () => {
  const body = Array.from({ length: 500 }, (_, i) => `行${i}`).join("\n");
  const out = budgetToolResult(body, 200);
  assert.ok(out.includes("行0"), "頭が残っていない");
  assert.ok(out.includes("行499"), "尻が残っていない");
  assert.ok(out.includes("中略"), "黙って切っている");
  assert.ok(out.length < body.length, "短くなっていない");
});

// 名乗る数が実際と食い違っていたら、黙って切るより性質が悪い。
test("落とした文字数は、残した頭と尻から逆算した実数と一致する", () => {
  const body = Array.from({ length: 400 }, (_, i) => `行${i}`).join("\n");
  const out = budgetToolResult(body, 300);
  const marker = /\n\n… 中略: ([\d,]+) 文字（[^）]*）…\n\n/.exec(out);
  assert.ok(marker !== null, "落とした量を言っていない");
  const claimed = Number(marker[1].replace(/,/g, ""));
  const [head, tail] = out.split(marker[0]);
  assert.equal(claimed, body.length - head.length - tail.length);
});

// 壊れた行が頭と尻にぶら下がると、何が落ちたのかがかえって読めなくなる。
test("切れ目は行の境界へ寄せる", () => {
  const body = Array.from({ length: 300 }, (_, i) => `これは${i}行目の内容です`).join("\n");
  const out = budgetToolResult(body, 400);
  const [head, tail] = out.split(/\n\n… 中略: [\d,]+ 文字（[^）]*）…\n\n/);
  assert.ok(head.split("\n").every((l) => /^これは\d+行目の内容です$/.test(l)), "頭に壊れた行がある");
  assert.ok(tail.split("\n").every((l) => /^これは\d+行目の内容です$/.test(l)), "尻に壊れた行がある");
});

// 改行が1つも無い巨大な1行でも、落ちずに切れること。
test("改行の無い巨大な1行でも切れる", () => {
  const out = budgetToolResult("z".repeat(5000), 100);
  assert.ok(out.includes("中略"), "切っていない");
  assert.ok(out.length < 5000);
});
