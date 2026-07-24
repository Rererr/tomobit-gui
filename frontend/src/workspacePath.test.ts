import test from "node:test";
import assert from "node:assert/strict";
import { addReadDir, displayDir } from "./workspacePath.ts";

test("パス表示は末尾2階層に畳む", () => {
  assert.equal(displayDir("/Users/example/personal-dev/tomobit-gui"), "personal-dev/tomobit-gui");
  assert.equal(displayDir("/Users"), "Users");
  assert.equal(displayDir("/Users/example/notes/"), "ren/notes");
});

test("未設定は空文字のまま、ルートは / と表示する", () => {
  assert.equal(displayDir(""), "");
  assert.equal(displayDir("/"), "/");
});

test("読み取り先は同じ場所を二度積まない", () => {
  const dirs = ["/a"];
  assert.deepEqual(addReadDir(dirs, "/work", "/b"), ["/a", "/b"]);
  assert.deepEqual(addReadDir(dirs, "/work", "/a"), ["/a"]);
});

test("作業ディレクトリ自身は読み取り先に積まない（Providerが元から読める）", () => {
  assert.deepEqual(addReadDir(["/a"], "/work", "/work"), ["/a"]);
});

test("キャンセル（空文字）は何も足さない", () => {
  assert.deepEqual(addReadDir(["/a"], "/work", ""), ["/a"]);
});
