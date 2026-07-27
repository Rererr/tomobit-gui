import { test } from "node:test";
import assert from "node:assert/strict";
import { SubtaskFrames } from "./subtaskFrames.ts";

test("sub を持たない行は会話そのもののターンへ", () => {
  const frames = new SubtaskFrames<string>();
  assert.equal(frames.target(undefined, "main"), "main");
  assert.equal(frames.target(undefined, null), null);
});

test("sub を持つ行は自分の枠へ。まだ無ければ null（呼び出し側が開く）", () => {
  const frames = new SubtaskFrames<string>();
  assert.equal(frames.target(1, "main"), null, "会話のターンへ落としてはいけない");
  frames.start(1, "f1");
  assert.equal(frames.target(1, "main"), "f1");
});

// 並走の本題。相関キーが無かった頃は、この3本が1枠に混ざるしかなかった。
test("同時に開いた枠は、それぞれ別の当て先を返す", () => {
  const frames = new SubtaskFrames<string>();
  frames.start(1, "f1");
  frames.start(2, "f2");
  frames.start(3, "f3");
  assert.equal(frames.running, 3);
  assert.equal(frames.target(1, "main"), "f1");
  assert.equal(frames.target(2, "main"), "f2");
  assert.equal(frames.target(3, "main"), "f3");
  // 会話そのもののターンは巻き込まれない。
  assert.equal(frames.target(undefined, "main"), "main");
});

// ひとつの「いま開いている枠」で持っていた頃の壊れ方: 先に終わった子の
// turn.finished が全員を閉じ、まだ走っている子の本文が行き場を失っていた。
test("先に終わった子が、まだ走っている枠を閉じない", () => {
  const frames = new SubtaskFrames<string>();
  frames.start(1, "f1");
  frames.start(2, "f2");

  assert.equal(frames.finish(2), "f2");
  assert.equal(frames.running, 1);
  assert.equal(frames.target(1, "main"), "f1", "隣を閉じたら自分の枠が消えた");
  assert.equal(frames.target(2, "main"), null, "閉じた枠へはもう入らない");

  assert.equal(frames.finish(1), "f1");
  assert.equal(frames.running, 0);
});

test("閉じる対象が無いときは何も返さない", () => {
  const frames = new SubtaskFrames<string>();
  assert.equal(frames.finish(undefined), null, "会話のターンを閉じるのは呼び出し側");
  assert.equal(frames.finish(9), null, "開いていない番号");
  frames.start(1, "f1");
  frames.finish(1);
  assert.equal(frames.finish(1), null, "二度閉じても壊れない");
});

// 枠の実体はライブがメッセージ id、再生が配列 index。同じ規則を両方が通す。
test("参照の型は呼び出し側が決める", () => {
  const byIndex = new SubtaskFrames<number>();
  byIndex.start(1, 7);
  assert.equal(byIndex.target(1, -1), 7);
  assert.equal(byIndex.target(undefined, -1), -1);
});
