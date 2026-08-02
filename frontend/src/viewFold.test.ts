import { test } from "node:test";
import assert from "node:assert/strict";
import { foldViewEvents } from "./viewFold.ts";
import type { ChatMessage, TurnMessage } from "./types.ts";

// 過去セッションの再生 (ADR-0003 Decision 1: ライブと同じ構造化描画)。
// ここが確かめるのは**反応の印がライブと同じ枠に付くこと**で、n → 枠の規則は
// TurnIndex（reaction.ts）としてライブと共有している — 共有の証拠は
// reaction.test.ts が規則そのものを、こちらが再生側の配線を見る。

function turns(messages: ChatMessage[]): TurnMessage[] {
  return messages.filter((m): m is TurnMessage => m.kind === "turn");
}

test("reaction イベントで、そのターンの枠に印が立つ", () => {
  const messages = foldViewEvents([
    { type: "task.started", sid: "s1" },
    { type: "turn.started", n: 1, provider: "claude-code" },
    { type: "text", text: "直した" },
    { type: "turn.finished", n: 1, duration_ms: 1200 },
    { type: "turn.started", n: 2, provider: "claude-code" },
    { type: "turn.finished", n: 2, duration_ms: 900 },
    { type: "reaction", n: 2, word: "up" },
  ]);
  const [first, second] = turns(messages);
  assert.equal(first.reaction, undefined, "押していないターンには何も付かない");
  assert.equal(second.reaction, "up");
});

test("clear は印を外す（取り消しがスクロールバックに残っている）", () => {
  const messages = foldViewEvents([
    { type: "task.started", sid: "s1" },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
    { type: "reaction", n: 1, word: "down" },
    { type: "reaction", n: 1, word: "clear" },
  ]);
  assert.equal(turns(messages)[0].reaction, undefined);
});

test("最後に置いた反応が残る（置き直しは上書き）", () => {
  const messages = foldViewEvents([
    { type: "task.started", sid: "s1" },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
    { type: "reaction", n: 1, word: "up" },
    { type: "reaction", n: 1, word: "meh" },
  ]);
  assert.equal(turns(messages)[0].reaction, "meh");
});

// 締めが読むのは**そのタスクの最後の1件だけ**（本体 ADR-0057 Decision 2）。
// 複数のターンに印が並ぶ再生は、そのタスクが何と記録されたかについて嘘をつく。
// ライブと再生は同じ規則で描く（ADR-0003 Decision 1）。
test("印はタスクにつき1つ — 別のターンへ置き直すと前の印は降りる", () => {
  const messages = foldViewEvents([
    { type: "task.started", sid: "s1" },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
    { type: "turn.started", n: 2, provider: "codex" },
    { type: "turn.finished", n: 2, duration_ms: 100 },
    { type: "reaction", n: 1, word: "up" },
    { type: "reaction", n: 2, word: "down" },
  ]);
  const [first, second] = turns(messages);
  assert.equal(first.reaction, undefined, "3ターン目の👍と7ターン目の👎が両方見えてはいけない");
  assert.equal(second.reaction, "down", "印は最後に置いたターンへ移る");
});

test("区切りの向こう側の印は降ろさない — あれは別のタスクの答え", () => {
  const messages = foldViewEvents([
    { type: "task.started", sid: "s1" },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
    { type: "reaction", n: 1, word: "up" },
    { type: "task.finished", sid: "s1" },
    { type: "task.started", sid: "s2" },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
    { type: "reaction", n: 1, word: "down" },
  ]);
  const [older, newer] = turns(messages);
  assert.equal(older.reaction, "up", "前のタスクの記録を消してはいけない");
  assert.equal(newer.reaction, "down");
});

// 台帳の n はタスクごとに1から振り直される（本体 ADR-0022 Decision 1）。
// n だけを鍵にすると、区切りの向こう側の n=1 に印が付く。
test("区切りを跨いだ別タスクの n=1 に印が付かない", () => {
  const messages = foldViewEvents([
    { type: "task.started", sid: "s1" },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "text", text: "1つ目のタスクの1ターン目" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
    { type: "task.finished", sid: "s1" },
    { type: "task.started", sid: "s2" },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "text", text: "2つ目のタスクの1ターン目" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
    { type: "reaction", n: 1, word: "up" },
  ]);
  const [older, newer] = turns(messages);
  assert.equal(older.reaction, undefined, "区切りの向こう側のターンに付いた");
  assert.equal(newer.reaction, "up");
});

// 分割の畳み戻し（本体 ADR-0028/0030）は同じ n を繰り返す。**2つ目の枠が結論**
// （親Providerの統合報告）で、人が読んで反応するのはそちら —— 最初の枠は
// 「分割して走らせる」というアナウンスにすぎない。印は結論の枠へ付ける。
test("同じ n が繰り返されたら、印は後から来た枠（結論）へ付く", () => {
  const messages = foldViewEvents([
    { type: "task.started", sid: "s1" },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "text", text: "分割して走らせる（アナウンス）" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "text", text: "畳み戻しの結論" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
    { type: "reaction", n: 1, word: "down" },
  ]);
  const [announce, conclusion] = turns(messages);
  assert.equal(announce.reaction, undefined);
  assert.equal(conclusion.reaction, "down");
});

test("結論の枠が後から来ても、先に置いた印はそちらへ移る", () => {
  // 走行中に押した反応は、畳み戻しの結論が来る前に記帳されうる。置き換えた
  // だけで移さないと、置いたはずの印が画面から黙って消える。
  const messages = foldViewEvents([
    { type: "task.started", sid: "s1" },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "text", text: "分割して走らせる（アナウンス）" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
    { type: "reaction", n: 1, word: "up" },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "text", text: "畳み戻しの結論" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
  ]);
  const [announce, conclusion] = turns(messages);
  assert.equal(announce.reaction, undefined, "置き換えた枠に印を残さない");
  assert.equal(conclusion.reaction, "up", "印は結論の枠へ移る");
});

// 分割の子は経験を持たない（本体 ADR-0054）ので、反応の効く先が無い。
test("分割の子の枠には印が付かない", () => {
  const messages = foldViewEvents([
    { type: "task.started", sid: "s1" },
    { type: "turn.started", n: 1, provider: "codex", sub: 1, sub_total: 2 },
    { type: "text", text: "子の本文", sub: 1 },
    { type: "turn.finished", n: 1, duration_ms: 100, sub: 1 },
    { type: "reaction", n: 1, word: "up" },
  ]);
  const [child] = turns(messages);
  assert.equal(child.sub, 1);
  assert.equal(child.reaction, undefined, "子の番号を宛先にしてはいけない");
});

test("読めない reaction は印を付けない", () => {
  const messages = foldViewEvents([
    { type: "task.started", sid: "s1" },
    { type: "turn.started", n: 1, provider: "codex" },
    { type: "turn.finished", n: 1, duration_ms: 100 },
    { type: "reaction", n: "1", word: "up" },
    { type: "reaction", n: 9, word: "up" },
  ]);
  assert.equal(turns(messages)[0].reaction, undefined);
});
