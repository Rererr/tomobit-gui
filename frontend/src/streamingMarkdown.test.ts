import test from "node:test";
import assert from "node:assert/strict";
import { splitStreamingMarkdown } from "./streamingMarkdown.ts";

// この関数の値打ちは「確定ぶんが二度と変わらない」の一点にある。それさえ
// 成り立てば memo が再パースを飛ばし、毎フレームの費用が末尾だけに閉じる。

test("空行で段落を切り、最後の要素だけが伸びる末尾になる", () => {
  const parts = splitStreamingMarkdown("最初の段落\n\n次の段落を書き途中");
  assert.equal(parts.length, 2);
  assert.equal(parts[0], "最初の段落\n");
  assert.equal(parts[1], "次の段落を書き途中");
});

test("空行がまだ来ていなければ切らない（全部が末尾）", () => {
  assert.deepEqual(splitStreamingMarkdown("まだ1段落目"), ["まだ1段落目"]);
});

// 追記しかされない以上、確定ぶんは前回の結果と同一でなければならない。
// ここが崩れると memo が効かず、修正そのものが無意味になる。
test("追記しても、確定済みの段落は1文字も変わらない", () => {
  const first = splitStreamingMarkdown("段落A\n\n段落B\n\n書き途中");
  const later = splitStreamingMarkdown("段落A\n\n段落B\n\n書き途中がもっと伸びた");
  assert.deepEqual(first.slice(0, -1), later.slice(0, -1));
});

// フェンスの中の空行で切ると、1つのコードブロックが2つに割れて描画が壊れる。
test("コードブロックの中の空行では切らない", () => {
  const parts = splitStreamingMarkdown("```sh\nls\n\necho hi\n```\n\nあと書き");
  assert.equal(parts.length, 2);
  assert.ok(parts[0].includes("echo hi"), "フェンスの中で切れている");
  assert.equal(parts[1], "あと書き");
});

test("閉じていないフェンスは末尾のまま持ち越す（流れている最中の常態）", () => {
  assert.deepEqual(splitStreamingMarkdown("```sh\nls\n\necho hi"), ["```sh\nls\n\necho hi"]);
});

test("~~~ は ``` では閉じない", () => {
  const parts = splitStreamingMarkdown("~~~\na\n\n```\n\nb");
  assert.equal(parts.length, 1, "別種の記号で閉じたことにしている");
});

test("空行が続いても空の段落を作らない", () => {
  const parts = splitStreamingMarkdown("A\n\n\n\nB");
  assert.deepEqual(parts, ["A\n", "\n\nB"]);
});

// 空行が一度も来ない本文への歯止め。ここが効かないと末尾が青天井に伸び、
// 再パースの費用がまた累積量に比例してしまう（修正前の症状に戻る）。
const long = (n: number) => Array.from({ length: n }, (_, i) => `第${i}文。`).join("");

test("空行が来なくても、閾値を超えたら安全な位置で切る", () => {
  const text = `${long(400)}\n次の段落に見える行\nさらに続く`;
  const parts = splitStreamingMarkdown(text);
  assert.ok(parts.length > 1, "伸び続ける末尾が切られていない");
  assert.ok(parts[0].length > 2000, "閾値より手前で切っている");
});

test("強制的な切れ目でも、確定ぶんは追記で変わらない", () => {
  const head = `${long(400)}\n独立した行\n`;
  const a = splitStreamingMarkdown(`${head}途中`);
  const b = splitStreamingMarkdown(`${head}途中がもっと伸びた`);
  assert.deepEqual(a.slice(0, -1), b.slice(0, -1));
});

test("リスト・表・引用・継続行の途中では強制的に切らない", () => {
  for (const [label, next] of [
    ["リスト", "- 項目"],
    ["番号リスト", "1. 項目"],
    ["表", "| a | b |"],
    ["引用", "> 引用"],
    ["継続行", "  つづき"],
    ["setext下線", "----"],
  ] as const) {
    const parts = splitStreamingMarkdown(`${long(400)}\n${next}\n${next}`);
    assert.equal(parts.length, 1, `${label}の途中で切っている`);
  }
});

test("フェンスの中では、閾値を超えても切らない", () => {
  const parts = splitStreamingMarkdown(`\`\`\`sh\n${long(400)}\necho hi\necho bye`);
  assert.equal(parts.length, 1, "コードブロックが割れている");
});

test("結合すれば元の全文に戻る（1文字も落とさない）", () => {
  for (const src of [
    "A\n\nB\n\nC",
    "```js\nconst a = 1;\n\nconst b = 2;\n```\n\nおわり",
    "改行なし",
    "A\n\n\n\nB",
    "",
    `${long(400)}\n独立した行\nつづき`,
    `${long(300)}\n- 項目\n- 項目`,
  ]) {
    assert.equal(splitStreamingMarkdown(src).join("\n"), src, `復元できない: ${JSON.stringify(src)}`);
  }
});
