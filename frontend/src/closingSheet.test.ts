import test from "node:test";
import assert from "node:assert/strict";
import { closingSections, firstUserSay } from "./closingSheet.ts";
import type { ClosingSnapshot } from "./closingSheet.ts";
import type { ChatMessage } from "./types.ts";
import type { main } from "../wailsjs/go/models";

const pane = (id: string, working_dir?: string): main.PaneConfig =>
  ({ id, working_dir }) as main.PaneConfig;

const snapshot = (over: Partial<ClosingSnapshot> = {}): ClosingSnapshot => ({
  done: false,
  question: null,
  notes: [],
  firstUserSay: "",
  ...over,
});

test("締めの走っている窓だけがセクションになる", () => {
  const sections = closingSections(
    [pane("a"), pane("b"), pane("c")],
    new Map([
      ["a", snapshot()],
      ["c", snapshot()],
    ]),
  );
  assert.deepEqual(
    sections.map((s) => s.paneId),
    ["a", "c"],
  );
});

test("窓の一覧に無い断面は出力に漏れない", () => {
  // 断面の掃除（窓が畳まれた時の unmount cleanup）が漏れても、格子に居ない窓の
  // 節が1枚に現れてはいけない。断面の Map ではなく窓の一覧が正本であることの固定。
  const sections = closingSections(
    [pane("a")],
    new Map([
      ["a", snapshot()],
      ["stale", snapshot()],
    ]),
  );
  assert.deepEqual(
    sections.map((s) => s.paneId),
    ["a"],
  );
});

test("セクションの並びは窓の並びで、断面の到着順ではない", () => {
  const sections = closingSections(
    [pane("a"), pane("b"), pane("c")],
    // 締めの断面は届いた順に積まれる（速い窓が先）。並びの正本は窓の一覧。
    new Map([
      ["c", snapshot()],
      ["a", snapshot()],
      ["b", snapshot()],
    ]),
  );
  assert.deepEqual(
    sections.map((s) => s.paneId),
    ["a", "b", "c"],
  );
});

test("窓が1つでもセクションは作る", () => {
  const sections = closingSections([pane("main", "/repo")], new Map([["main", snapshot()]]));
  assert.equal(sections.length, 1);
});

test("見出しは既にある事実だけを引く", () => {
  const [section] = closingSections(
    [pane("a", "/Users/ren/personal-dev/tomobit")],
    new Map([["a", snapshot({ firstUserSay: "認証バグを直して" })]]),
  );
  assert.equal(section?.workingDir, "/Users/ren/personal-dev/tomobit");
  assert.equal(section?.quote, "認証バグを直して");
});

test("まだ何も送っていない窓・場所を決めていない窓でもセクションは落ちない", () => {
  // 引用も場所も無ければ空のまま渡す。GUI は代わりの要約を作らない
  // （見出しを埋めるための言葉は器の側の仕事）。
  const [section] = closingSections([pane("a")], new Map([["a", snapshot()]]));
  assert.equal(section?.workingDir, "");
  assert.equal(section?.quote, "");
});

test("空白だけの働く場所は未設定として渡す", () => {
  const [section] = closingSections([pane("a", "  ")], new Map([["a", snapshot()]]));
  assert.equal(section?.workingDir, "");
});

test("締めが終わった窓は done になる", () => {
  const [section] = closingSections([pane("a")], new Map([["a", snapshot({ done: true })]]));
  assert.equal(section?.done, true);
});

test("締めが終わった窓に未回答の問いを残さない", () => {
  // 相手のプロセスはもう居ない。押しても答えは締めのどこにも届かず、
  // SendLine が新しい chat を起こすだけになる。
  const [section] = closingSections(
    [pane("a")],
    new Map([
      ["a", snapshot({ done: true, question: { prompt: "今回、どうだった?", choices: [] } })],
    ]),
  );
  assert.equal(section?.question, null);
});

test("締めの途中の問いと本体の行はそのまま渡る", () => {
  const question = { prompt: "今回、どうだった?", choices: [{ send: "1", label: "文句なし" }] };
  const [section] = closingSections(
    [pane("a")],
    new Map([["a", snapshot({ question, notes: ["知覚を書いた"] })]]),
  );
  assert.deepEqual(section?.question, question);
  assert.deepEqual(section?.notes, ["知覚を書いた"]);
});

test("見出しの引用は最初のユーザー発言", () => {
  const messages: ChatMessage[] = [
    { id: "1", kind: "system", text: "起動した" },
    { id: "2", kind: "user", text: "認証バグを直して" },
    { id: "3", kind: "user", text: "テストも足して" },
  ];
  assert.equal(firstUserSay(messages), "認証バグを直して");
});

test("1度も送っていない窓の引用は空", () => {
  const messages: ChatMessage[] = [{ id: "1", kind: "note", text: "こんにちは", await: false }];
  assert.equal(firstUserSay(messages), "");
});
