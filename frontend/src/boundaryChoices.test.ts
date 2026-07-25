import test from "node:test";
import assert from "node:assert/strict";
import { parseBoundaryQuestion } from "./boundaryChoices.ts";

test("Feedbackの質問を本文とボタンに割る（Enterは空送信）", () => {
  const q = parseBoundaryQuestion(
    "今回、どうだった? [1=文句なし / 2=まあまあ（手を焼いた） / 3=だめだった / Enter=まだ言えない] ",
  );
  assert.equal(q.prompt, "今回、どうだった?");
  assert.deepEqual(q.choices, [
    { send: "1", label: "文句なし" },
    { send: "2", label: "まあまあ（手を焼いた）" },
    { send: "3", label: "だめだった" },
    { send: "", label: "まだ言えない" },
  ]);
});

test("鏡・好奇心の2択も同じ形で読める", () => {
  const q = parseBoundaryQuestion("どうだった? [1=意外 / 2=知ってた / 3=それ違う / Enter=スキップ] ");
  assert.equal(q.prompt, "どうだった?");
  assert.deepEqual(
    q.choices.map((c) => c.send),
    ["1", "2", "3", ""],
  );
});

test("問い本文に角括弧があっても選択肢は最後の括弧から読む", () => {
  const q = parseBoundaryQuestion("「[実装] は速い」と見えた [1=はい / Enter=スキップ]");
  assert.equal(q.prompt, "「[実装] は速い」と見えた");
  assert.deepEqual(
    q.choices.map((c) => c.label),
    ["はい", "スキップ"],
  );
});

test("ラベルにスラッシュが入っても区切りは前後に空白のあるスラッシュだけ", () => {
  const q = parseBoundaryQuestion("問い [1=a/b / Enter=やめる]");
  assert.deepEqual(q.choices, [
    { send: "1", label: "a/b" },
    { send: "", label: "やめる" },
  ]);
});

test("角括弧が無い（自由記述を待つ）行は選択肢を作らない", () => {
  const q = parseBoundaryQuestion("なにか一言ある?");
  assert.equal(q.prompt, "なにか一言ある?");
  assert.deepEqual(q.choices, []);
});

test("角括弧はあるが選択肢の形をしていない行も自由記述として扱う", () => {
  const q = parseBoundaryQuestion("進捗 [50%] はどう?");
  assert.equal(q.prompt, "進捗 [50%] はどう?");
  assert.deepEqual(q.choices, []);
});
