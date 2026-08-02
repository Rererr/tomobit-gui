import { test } from "node:test";
import assert from "node:assert/strict";
import { sameSpeakerAsPrevious, SPEAKER_NAME_REPEAT_EVERY } from "./speakerName.ts";
import type { ChatMessage } from "./types.ts";

// 会話は1列で、誰の声かは名前が言う（ADR-0014 Decision 1）。連続する同じ話者では
// 名前を省くが、**省き続けはしない** —— 名前が1つも見えない画面には、誰が喋って
// いるかの手がかりが1つも無い（user と turn の本文色は同じ）。

let seq = 0;
function user(): ChatMessage {
  return { id: `m${seq++}`, kind: "user", text: "…" };
}
function tomo(): ChatMessage {
  return { id: `m${seq++}`, kind: "turn", n: 1, provider: "codex", blocks: [] };
}
function note(): ChatMessage {
  return { id: `m${seq++}`, kind: "note", text: "…", await: false };
}

/** 各メッセージが名前行を出すか（true = 出す）。 */
function names(messages: ChatMessage[]): boolean[] {
  return messages.map((_, i) => !sameSpeakerAsPrevious(messages, i));
}

test("話者が変わったら名前を出す", () => {
  assert.deepEqual(names([user(), tomo(), user()]), [true, true, true]);
});

test("連続する同じ話者では名前を省く", () => {
  assert.deepEqual(names([user(), tomo(), tomo()]).slice(1), [true, false]);
});

test("連続が長くなったら名前を出し直す — 名前が1つも見えない画面を作らない", () => {
  // 実測: Tomo が3連続で返した中間位置までスクロールすると、画面に "Tomo" も
  // "You" も1つも無い状態が再現した。1枠が画面より高いことは珍しくないので、
  // 名前を出さない枠が2件以上続くとこの状態がそのまま残る。
  const run = [tomo(), tomo(), tomo(), tomo(), tomo()];
  const shown = names(run);
  assert.deepEqual(shown, [true, false, true, false, true]);
  const gaps = maxRunOf(shown, false);
  assert.ok(
    gaps < SPEAKER_NAME_REPEAT_EVERY,
    `名前無しが ${gaps} 件続く — 1枠が画面より高いと名前が1つも見えなくなる`,
  );
});

test("名前を持たない声（note/system/stderr）が挟まると連続は切れる", () => {
  // 会話の脇からの声は名前欄そのものを持たない。挟まった後は必ず名前が出る
  // （Slack で参加通知が挟まると連続がリセットされるのと同じ）。
  const messages = [tomo(), note(), tomo()];
  assert.equal(sameSpeakerAsPrevious(messages, 2), false, "脇からの声を跨いで連続とみなさない");
});

test("先頭は常に名前を出す", () => {
  assert.equal(sameSpeakerAsPrevious([tomo()], 0), false);
});

/** value が連続する最大の長さ。 */
function maxRunOf(values: boolean[], value: boolean): number {
  let max = 0;
  let run = 0;
  for (const v of values) {
    run = v === value ? run + 1 : 0;
    max = Math.max(max, run);
  }
  return max;
}
