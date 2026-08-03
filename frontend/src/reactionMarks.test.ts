import { test } from "node:test";
import assert from "node:assert/strict";
import { applyConfirmedReaction, clearPendingMarks, markTurn, openTurn } from "./reactionMarks.ts";
import { TurnIndex } from "./reaction.ts";
import type { ChatMessage, TurnMessage } from "./types.ts";

/** 終わったターン枠1つ。印は呼び出し側が足す（省いた枠は「まだ何も置いていない」）。 */
function turn(id: string, n: number, mark: { reaction?: string; reactionPending?: string } = {}): TurnMessage {
  return { id, kind: "turn", n, provider: "claude-code", blocks: [], finished: { durationMs: 1 }, ...mark };
}

/** ターン枠と、そのタスクの「n → 枠の id」の表を一度に組む。 */
function conversation(...turns: TurnMessage[]): { messages: ChatMessage[]; index: TurnIndex<string> } {
  const index = new TurnIndex<string>();
  for (const t of turns) {
    index.start(t.n, t.id);
  }
  return { messages: [...turns], index };
}

function markOf(messages: ChatMessage[], id: string): { reaction?: string; reactionPending?: string } {
  const m = messages.find((x) => x.id === id);
  assert.ok(m !== undefined && m.kind === "turn", `${id} の枠が消えた`);
  return { reaction: m.reaction, reactionPending: m.reactionPending };
}

// --- 記帳が返った1件を画面へ写す ---

test("記帳が返った枠に印が立ち、その枠の送信待ちは降りる", () => {
  const { messages, index } = conversation(turn("t1", 1, { reactionPending: "up" }));
  const next = applyConfirmedReaction(messages, index, 1, "up");
  assert.deepEqual(markOf(next, "t1"), { reaction: "up", reactionPending: undefined });
});

test("画面に見える印はタスクにつき1つ — 他の枠の印は降ろす", () => {
  // 締めが読むのはそのタスクの最後の1件だけ（本体 ADR-0057 Decision 2）。
  // 3ターン目の 👍 と7ターン目の 👎 が同時に見えている画面は、記録される内容に
  // ついて嘘をつく（ADR-0014 Decision 4 の核心）。
  const { messages, index } = conversation(turn("t3", 3, { reaction: "up" }), turn("t7", 7));
  const next = applyConfirmedReaction(messages, index, 7, "down");
  assert.deepEqual(markOf(next, "t7"), { reaction: "down", reactionPending: undefined });
  assert.deepEqual(markOf(next, "t3"), { reaction: undefined, reactionPending: undefined }, "前に置いた印が残っている");
});

test("他の枠に残った送信待ちも降ろす — 待ちの姿でも2つ並べない", () => {
  // 溜め場にはまだ残っていて、送られれば記帳が返ってその枠へ着地する。
  // 一瞬だけ待ちが消えるのを許して、見える印の数を1つに保つ。
  const { messages, index } = conversation(turn("t3", 3, { reactionPending: "meh" }), turn("t7", 7));
  const next = applyConfirmedReaction(messages, index, 7, "down");
  assert.deepEqual(markOf(next, "t3"), { reaction: undefined, reactionPending: undefined });
});

test("印も待ちも持たない枠は同じ参照のまま", () => {
  // 触った枠だけを差し替える（MessageView の浅い比較が「動いていないものは
  // 描き直さない」を成立させている — 2026-07-26 の応答停止の境界）。
  const { messages, index } = conversation(turn("t1", 1), turn("t2", 2), turn("t3", 3, { reaction: "up" }));
  const next = applyConfirmedReaction(messages, index, 2, "up");
  assert.equal(next[0], messages[0], "無関係の枠を作り直した");
  assert.notEqual(next[1], messages[1], "印を書いた枠");
  assert.notEqual(next[2], messages[2], "印を降ろした枠");
});

test("区切りの向こう側の枠の印は降ろさない — あれは別タスクの答え", () => {
  const previousTask = turn("t1", 1, { reaction: "up" });
  const index = new TurnIndex<string>();
  index.start(1, previousTask.id);
  // 台帳の n はタスクごとに1から振り直される（本体 ADR-0022 Decision 1）。
  index.reset();
  const opened = turn("t1-next", 1);
  index.start(1, opened.id);
  const next = applyConfirmedReaction([previousTask, opened], index, 1, "down");
  assert.deepEqual(markOf(next, "t1"), { reaction: "up", reactionPending: undefined }, "前のタスクの記録を消した");
  assert.deepEqual(markOf(next, "t1-next"), { reaction: "down", reactionPending: undefined });
});

test("clear の記帳は印を外す — 取り消しは「答えない」であって「答えた」ではない", () => {
  const { messages, index } = conversation(turn("t1", 1, { reaction: "up", reactionPending: "clear" }));
  assert.deepEqual(markOf(applyConfirmedReaction(messages, index, 1, "clear"), "t1"), {
    reaction: undefined,
    reactionPending: undefined,
  });
});

test("いまのタスクに無い番号の記帳は、ログを1つも動かさない", () => {
  const { messages, index } = conversation(turn("t1", 1, { reaction: "up" }));
  assert.equal(applyConfirmedReaction(messages, index, 9, "down"), messages, "宛先の無い記帳でログを作り直した");
});

// --- 押した瞬間の送信待ち ---

test("押した語は、その枠の送信待ちとして立つ", () => {
  const { messages, index } = conversation(turn("t1", 1), turn("t2", 2));
  const next = markTurn(messages, index, 2, { reactionPending: "down" });
  assert.deepEqual(markOf(next, "t2"), { reaction: undefined, reactionPending: "down" });
  assert.equal(next[0], messages[0], "押していない枠を作り直した");
});

test("送れなかった送信待ちは降ろす — 記帳を待つ姿で固まらせない", () => {
  const { messages, index } = conversation(turn("t1", 1, { reaction: "up", reactionPending: "clear" }));
  const next = markTurn(messages, index, 1, { reactionPending: undefined });
  assert.deepEqual(markOf(next, "t1"), { reaction: "up", reactionPending: undefined }, "確定した印まで消した");
});

test("いまのタスクに無い番号への書き込みは、ログを1つも動かさない", () => {
  const { messages, index } = conversation(turn("t1", 1));
  assert.equal(markTurn(messages, index, 9, { reactionPending: "up" }), messages);
});

// --- 宛先が消えた（区切り・プロセス終了） ---

test("宛先が消えたら送信待ちは全部降り、確定した印は残る", () => {
  const messages: ChatMessage[] = [
    turn("t1", 1, { reaction: "up" }),
    { id: "n1", kind: "note", text: "境界の問い", await: true },
    turn("t2", 2, { reactionPending: "down" }),
    turn("t3", 3, { reaction: "meh", reactionPending: "clear" }),
  ];
  const next = clearPendingMarks(messages);
  assert.deepEqual(markOf(next, "t1"), { reaction: "up", reactionPending: undefined });
  assert.deepEqual(markOf(next, "t2"), { reaction: undefined, reactionPending: undefined });
  assert.deepEqual(markOf(next, "t3"), { reaction: "meh", reactionPending: undefined });
  assert.equal(next[1], messages[1], "ターンでない行を作り直した");
});

test("降ろすものが無ければ、ログはそのまま（境界のたびに全体を作り直さない）", () => {
  const messages: ChatMessage[] = [turn("t1", 1, { reaction: "up" })];
  assert.equal(clearPendingMarks(messages), messages);
});

// --- 同じ n を名乗る枠が2つ現れる（分割の畳み戻し） ---

test("置き換えられた枠の印と送信待ちは、結論の枠へ移る", () => {
  // 同じ n が繰り返されるのは分割の畳み戻し（本体 ADR-0028/0030）で、
  // 2つ目の枠こそが結論である。移さないと、置いたはずの印が黙って消える。
  const announce = turn("announce", 1, { reaction: "up", reactionPending: "clear" });
  const conclusion = turn("conclusion", 1);
  const next = openTurn([announce], conclusion, announce.id);
  assert.deepEqual(markOf(next, "conclusion"), { reaction: "up", reactionPending: "clear" });
  assert.deepEqual(markOf(next, "announce"), { reaction: undefined, reactionPending: undefined }, "印が2つ見えている");
});

test("移す先の枠が無ければ、開いた枠をそのまま足す", () => {
  const first = turn("t1", 1, { reaction: "up" });
  const opened = turn("t2", 2);
  const next = openTurn([first], opened, null);
  assert.deepEqual(next.map((m) => m.id), ["t1", "t2"]);
  assert.equal(next[0], first, "無関係の枠を作り直した");
  assert.deepEqual(markOf(next, "t2"), { reaction: undefined, reactionPending: undefined });
});

test("開く枠は書き換えない — 同じ引数で二度呼んでも同じ結果になる", () => {
  // React.StrictMode は setMessages の更新関数を二度呼ぶ。開く枠を破壊的に
  // 書き換えると、二度目は「印を持った枠」を引き継ぎ元にすることになる。
  const announce = turn("announce", 1, { reaction: "up" });
  const opened = turn("conclusion", 1);
  const once = openTurn([announce], opened, announce.id);
  const twice = openTurn([announce], opened, announce.id);
  assert.deepEqual(markOf(once, "conclusion"), markOf(twice, "conclusion"));
  assert.deepEqual(markOf(twice, "announce"), { reaction: undefined, reactionPending: undefined });
});
