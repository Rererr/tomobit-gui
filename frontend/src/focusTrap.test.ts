import test from "node:test";
import assert from "node:assert/strict";
import { nextFocusTarget } from "./focusTrap.ts";

test("末尾の要素でTabを押すと先頭へ折り返す", () => {
  const list = ["a", "b", "c"];
  assert.equal(nextFocusTarget(list, "c", false), "a");
});

test("先頭の要素でShift+Tabを押すと末尾へ折り返す", () => {
  const list = ["a", "b", "c"];
  assert.equal(nextFocusTarget(list, "a", true), "c");
});

test("中間の要素では折り返さず、ブラウザ既定の移動に委ねる", () => {
  const list = ["a", "b", "c"];
  assert.equal(nextFocusTarget(list, "b", false), null);
  assert.equal(nextFocusTarget(list, "b", true), null);
});

test("要素が1つだけなら、Tab・Shift+Tabのどちらでも自分自身に留まる", () => {
  const list = ["only"];
  assert.equal(nextFocusTarget(list, "only", false), "only");
  assert.equal(nextFocusTarget(list, "only", true), "only");
});

test("フォーカスが対象リストの外にあるなら、奪わずnullを返す", () => {
  // 締めと権限、2つのモーダルが同一窓に重なった場合の共存を想定
  // （前面のモーダルから背後のモーダルへ焦点を奪い返さない）。
  const list = ["a", "b"];
  assert.equal(nextFocusTarget(list, "outside", false), null);
});

test("フォーカス可能な要素が無いならnullを返す", () => {
  assert.equal(nextFocusTarget([], "x", false), null);
});
