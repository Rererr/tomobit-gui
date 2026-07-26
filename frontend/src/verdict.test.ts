import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictActions, verdictMark } from "./verdict.ts";

test("印は判定のあるセッションにだけ出る", () => {
  assert.equal(verdictMark("up"), "👍");
  assert.equal(verdictMark("down"), "👎");
  assert.equal(verdictMark(""), "");
});

test("知らない語は印を出さない — 本体の語彙が増えても嘘をつかない", () => {
  // ADR-0032 の消費者規律: 未知は無視する。up か down のどちらかへ寄せて
  // 描くより、「まだ何も置かれていない」と見える方が嘘が小さい。
  assert.equal(verdictMark("clear"), "");
  assert.equal(verdictMark("sideways"), "");
});

test("判定が無ければ、置ける手は2つだけ（取り消しは出ない）", () => {
  const actions = verdictActions("");
  assert.deepEqual(
    actions.map((a) => a.word),
    ["up", "down"],
  );
  assert.ok(actions.every((a) => !a.active));
});

test("判定があれば取り消しが並び、いまの手が押下状態になる", () => {
  const up = verdictActions("up");
  assert.deepEqual(
    up.map((a) => a.word),
    ["up", "down", "clear"],
  );
  assert.equal(up.find((a) => a.word === "up")?.active, true);
  assert.equal(up.find((a) => a.word === "down")?.active, false);
  // 取り消しは「いまの手」ではないので押下状態にはならない。
  assert.equal(up.find((a) => a.word === "clear")?.active, false);

  const down = verdictActions("down");
  assert.equal(down.find((a) => a.word === "down")?.active, true);
});

test("置き換えは1手でできる — 逆の判定は常に並ぶ", () => {
  for (const current of ["", "up", "down"]) {
    const words = verdictActions(current).map((a) => a.word);
    assert.ok(words.includes("up"), `${current}: 👍 が無い`);
    assert.ok(words.includes("down"), `${current}: 👎 が無い`);
  }
});

test("知らない語は「判定なし」として扱う", () => {
  assert.deepEqual(
    verdictActions("sideways").map((a) => a.word),
    ["up", "down"],
  );
});
