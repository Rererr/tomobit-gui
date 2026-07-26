import test from "node:test";
import assert from "node:assert/strict";
import { activityLabel, advanceActivity, formatElapsed, startActivity } from "./activity.ts";
import type { Activity } from "./activity.ts";
import type { ViewEvent } from "./types.ts";

const T0 = 1_000_000;

function requested(provider = ""): Activity {
  return { phase: "requested", provider, since: T0, swallowReady: false };
}

function run(events: ViewEvent[], from: Activity | null = requested(), now = T0 + 5000): Activity | null {
  return events.reduce<Activity | null>((a, ev) => advanceActivity(a, ev, now), from);
}

test("送った直後は依頼中から始まる", () => {
  assert.deepEqual(startActivity("requested", T0), requested());
});

test("decided は段を変えずProvider名だけ足す（待ちは続いているので数え直さない）", () => {
  const a = run([{ type: "decided", provider: "claude-code" }]);
  assert.deepEqual(a, requested("claude-code"));
});

test("turn.started で実行中へ移り、経過を数え直す", () => {
  const a = run([{ type: "decided", provider: "claude-code" }, { type: "turn.started", n: 1, provider: "codex" }]);
  assert.deepEqual(a, { phase: "running", provider: "codex", since: T0 + 5000, swallowReady: false });
});

test("provider を持たない turn.started は decided で分かった名前を保つ", () => {
  const a = run([{ type: "decided", provider: "claude-code" }, { type: "turn.started", n: 1 }]);
  assert.equal(a?.provider, "claude-code");
});

test("ready で終わる — 本体がプロンプトに立った＝人の番", () => {
  assert.equal(run([{ type: "ready" }]), null);
});

// 初回送信の順序: 送る → 子プロセスが起きる(init) → ready → こちらの行を読む。
// この ready を人の番と読むと、一番長い沈黙が空白のまま残る。
test("開いたばかりのストリームの最初の ready は飲む（まだこちらの行を読んでいない）", () => {
  const a = run([{ type: "init", v: 1 }, { type: "ready" }]);
  assert.deepEqual(a, requested());
});

test("飲むのは1度だけ — 次の ready は人の番として効く", () => {
  assert.equal(run([{ type: "init", v: 1 }, { type: "ready" }, { type: "ready" }]), null);
});

test("ターンが始まれば読み飛ばす理由は消える（その後の ready で終わる）", () => {
  const a = run([{ type: "init", v: 1 }, { type: "turn.started", n: 1, provider: "codex" }]);
  assert.equal(advanceActivity(a, { type: "ready" }, T0 + 9000), null);
});

test("待っていない間の init は待ちを作らない", () => {
  assert.equal(run([{ type: "init", v: 1 }], null), null);
});

test("await の note で終わる（締めの質問は答える番）", () => {
  assert.equal(run([{ type: "note", text: "今回、どうだった?", await: true }]), null);
});

test("await でない note では終わらない — 器官が喋っただけで待ちは続く", () => {
  assert.deepEqual(run([{ type: "note", text: "知覚した" }]), requested());
});

test("task.finished / task.cancelled で終わる（ready を出さずに終わる経路の受け皿）", () => {
  assert.equal(run([{ type: "task.finished", sid: "s1" }]), null);
  assert.equal(run([{ type: "task.cancelled", sid: "s1" }]), null);
});

test("turn.finished では終わらない — ターンが閉じても本体はまだ喋りうる", () => {
  const running = run([{ type: "turn.started", n: 1, provider: "claude-code" }]);
  const after = advanceActivity(running, { type: "turn.finished", n: 1, duration_ms: 10 }, T0 + 9000);
  assert.deepEqual(after, running);
});

test("fold-back の次のターンはそのまま実行中を継ぐ", () => {
  const a = run([
    { type: "turn.started", n: 1, provider: "claude-code" },
    { type: "turn.finished", n: 1, duration_ms: 10 },
    { type: "turn.started", n: 1, provider: "claude-code" },
  ]);
  assert.equal(a?.phase, "running");
});

test("未知の type は状態を動かさない（契約: 消費者は未知の type を無視せよ）", () => {
  assert.deepEqual(run([{ type: "provider", name: "x" }, { type: "text", text: "あ" }, { type: "tool", name: "Edit" }]), requested());
});

test("待っていない間はどのイベントも待ちを作らない（turn.started を除く）", () => {
  for (const ev of [{ type: "decided", provider: "x" }, { type: "text", text: "あ" }, { type: "note", text: "n" }]) {
    assert.equal(run([ev], null), null, `${ev.type} が待ちを作った`);
  }
  assert.equal(run([{ type: "turn.started", n: 1, provider: "codex" }], null)?.phase, "running");
});

test("段の名前を出す。Provider名は分かったときだけ足す", () => {
  assert.equal(activityLabel(requested()), "依頼中");
  assert.equal(activityLabel(requested("claude-code")), "依頼中 · claude-code");
  assert.equal(activityLabel({ ...requested("codex"), phase: "running" }), "実行中 · codex");
});

test("区切りの尾部は器官の仕事なので Provider 名を出さない", () => {
  assert.equal(activityLabel({ ...requested("claude-code"), phase: "closing" }), "区切り中");
});

test("経過は秒、1分を超えたら分を出す", () => {
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(999), "0s");
  assert.equal(formatElapsed(59_999), "59s");
  assert.equal(formatElapsed(60_000), "1m00s");
  assert.equal(formatElapsed(605_000), "10m05s");
  // 時計の巻き戻し（NTP補正）で負になっても壊れない
  assert.equal(formatElapsed(-5000), "0s");
});
