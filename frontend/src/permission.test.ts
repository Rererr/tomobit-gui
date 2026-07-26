import test from "node:test";
import assert from "node:assert/strict";
import { parsePermissionEvent } from "./permission.ts";
import { parseBoundaryQuestion } from "./boundaryChoices.ts";

const ev = (o: Record<string, unknown>) => o;
// 本番と同じパーサを渡す（注入は依存を切るためで、挙動を変えるためではない）
const parsePermissionEvent2 = (o: Record<string, unknown>) =>
  parsePermissionEvent(o, parseBoundaryQuestion);

test("本体が出した道具と選択肢をそのまま読む", () => {
  const r = parsePermissionEvent2(ev({
    type: "permission", await: true,
    text: "Edit の使用を許可する? [1=許可する / Enter=許可しない]",
    tools: [{ tool: "Edit", detail: "/tmp/x.go" }],
  }));
  assert.notEqual(r, null);
  assert.equal(r!.tools[0].tool, "Edit");
  assert.equal(r!.tools[0].detail, "/tmp/x.go");
  // 選択肢は本体の角括弧から読む — GUI は語彙を持たない
  assert.equal(r!.question.choices.length, 2);
  assert.equal(r!.question.choices[0].send, "1");
  assert.equal(r!.question.choices[1].send, ""); // Enter
});

test("detail が無くても問いとしては成立する", () => {
  const r = parsePermissionEvent2(ev({
    text: "Bash の使用を許可する? [1=許可する / Enter=許可しない]",
    tools: [{ tool: "Bash" }],
  }));
  assert.notEqual(r, null);
  assert.equal(r!.tools[0].detail, "");
});

test("複数の道具をまとめて見せる", () => {
  const r = parsePermissionEvent2(ev({
    text: "Read と Edit の使用を許可する? [1=許可する / Enter=許可しない]",
    tools: [{ tool: "Read" }, { tool: "Edit", detail: "a.go" }],
  }));
  assert.equal(r!.tools.length, 2);
});

test("選択肢が読めないならボタンを発明しない", () => {
  // 角括弧が無い＝本体が選択肢を出していない。ここでボタンを作ると、
  // GUI が語彙を持つことになる（ADR-0005 Decision 2）。
  const r = parsePermissionEvent2(ev({ text: "許可して", tools: [{ tool: "Edit" }] }));
  assert.equal(r, null);
});

test("道具が無い・壊れている形はモーダルにしない", () => {
  const q = "[1=許可する / Enter=許可しない]";
  assert.equal(parsePermissionEvent2(ev({ text: q })), null);
  assert.equal(parsePermissionEvent2(ev({ text: q, tools: [] })), null);
  assert.equal(parsePermissionEvent2(ev({ text: q, tools: [{ detail: "x" }] })), null);
  assert.equal(parsePermissionEvent2(ev({ text: q, tools: "Edit" })), null);
});

test("名前のある道具だけを拾い、壊れた要素は落とす", () => {
  const r = parsePermissionEvent2(ev({
    text: "Edit の使用を許可する? [1=許可する / Enter=許可しない]",
    tools: [{ tool: "" }, null, { tool: "Edit" }],
  }));
  assert.equal(r!.tools.length, 1);
  assert.equal(r!.tools[0].tool, "Edit");
});
