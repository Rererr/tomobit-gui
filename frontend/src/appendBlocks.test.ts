import test from "node:test";
import assert from "node:assert/strict";
import { appendBlocksTo } from "./appendBlocks.ts";
import type { ChatMessage, TurnBlock, TurnMessage } from "./types.ts";

const text = (t: string): TurnBlock => ({ kind: "text", text: t });
const tool = (n: string): TurnBlock => ({ kind: "tool", name: n });

function turn(id: string, blocks: TurnBlock[] = []): ChatMessage {
  return { id, kind: "turn", n: 1, provider: "claude-code", blocks };
}

function turnAt(messages: ChatMessage[], id: string): TurnMessage {
  const m = messages.find((x) => x.id === id);
  assert.ok(m !== undefined && m.kind === "turn", `${id} が turn として見つからない`);
  return m;
}

test("溜まったブロックを開いているターンへまとめて追記する", () => {
  const before: ChatMessage[] = [turn("t1")];
  const after = appendBlocksTo(before, "t1", [tool("Read"), text("あ"), text("い")]);
  assert.deepEqual(turnAt(after, "t1").blocks, [tool("Read"), text("あい")]);
});

test("連続する text は1つに結合する（既存の末尾とも繋ぐ）", () => {
  const after = appendBlocksTo([turn("t1", [text("あ")])], "t1", [text("い"), text("う")]);
  assert.deepEqual(turnAt(after, "t1").blocks, [text("あいう")]);
});

test("text 以外を挟めば結合は切れる", () => {
  const after = appendBlocksTo([turn("t1")], "t1", [text("あ"), tool("Edit"), text("い")]);
  assert.deepEqual(turnAt(after, "t1").blocks, [text("あ"), tool("Edit"), text("い")]);
});

// 事故の再発を止めているのはこの性質そのもの: 何件積まれていても、複製は
// メッセージ配列1回・ブロック配列1回に閉じる。
test("元のメッセージ配列とブロック配列を書き換えない", () => {
  const original: TurnBlock[] = [text("あ")];
  const before: ChatMessage[] = [turn("t1", original)];
  appendBlocksTo(before, "t1", [text("い")]);
  assert.deepEqual(original, [text("あ")]);
  assert.deepEqual(turnAt(before, "t1").blocks, [text("あ")]);
});

test("対象ターン以外は参照ごと据え置く（memo が再描画を飛ばせる）", () => {
  const other = turn("t0", [text("済み")]);
  const after = appendBlocksTo([other, turn("t1")], "t1", [text("あ")]);
  assert.equal(after[0], other);
});

// 位置ではなく id で当てる: 溜めている間に note や stderr が挟まっても、
// 追記は正しいターンへ入り、並び順は到着順のまま動かない。
test("後ろに別のメッセージが挟まっていても、順序を崩さず正しいターンへ入る", () => {
  const before: ChatMessage[] = [
    turn("t1", [text("あ")]),
    { id: "n1", kind: "note", text: "診断", await: false },
  ];
  const after = appendBlocksTo(before, "t1", [text("い")]);
  assert.deepEqual(after.map((m) => m.id), ["t1", "n1"]);
  assert.deepEqual(turnAt(after, "t1").blocks, [text("あい")]);
});

test("開いているターンが無ければ末尾に新しく開いて受ける（落とさない）", () => {
  const after = appendBlocksTo([], "t9", [text("あ"), text("い")]);
  assert.equal(after.length, 1);
  const opened = turnAt(after, "t9");
  assert.deepEqual(opened.blocks, [text("あい")]);
  assert.equal(opened.n, 0);
  assert.equal(opened.provider, "");
});

test("積まれていなければ同じ配列をそのまま返す", () => {
  const before: ChatMessage[] = [turn("t1")];
  assert.equal(appendBlocksTo(before, "t1", []), before);
});
