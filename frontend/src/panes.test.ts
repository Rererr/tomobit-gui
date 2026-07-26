import test from "node:test";
import assert from "node:assert/strict";
import { paneGridClass, sharedPlaces } from "./panes.ts";
import type { main } from "../wailsjs/go/models";

const pane = (id: string, working_dir?: string): main.PaneConfig =>
  ({ id, working_dir }) as main.PaneConfig;

test("同じ場所で働く窓は両方とも指される", () => {
  const shared = sharedPlaces([
    pane("a", "/repo"),
    pane("b", "/repo"),
    pane("c", "/other"),
  ]);
  assert.equal(shared.has("a"), true);
  assert.equal(shared.has("b"), true);
  // 片方だけに言っても意味が無い: 共有は2つの窓の間の事実で、
  // どちらが「後から来た」かを GUI が判定するのは判断の座席になる。
  assert.equal(shared.has("c"), false);
});

test("場所を設定していない窓は共有に数えない", () => {
  // まだどこでも働いていない窓は、共有しているものが無い。空文字を1つの
  // 「場所」として数えると、新しく開いた窓が2つあるだけで警告が出る。
  const shared = sharedPlaces([pane("a"), pane("b"), pane("c", "")]);
  assert.equal(shared.size, 0);
});

test("空白だけの場所も未設定として扱う", () => {
  assert.equal(sharedPlaces([pane("a", "  "), pane("b", "   ")]).size, 0);
});

test("1つしか無い場所は共有ではない", () => {
  assert.equal(sharedPlaces([pane("a", "/repo")]).size, 0);
});

test("3つが同じ場所なら3つとも指される", () => {
  const shared = sharedPlaces([pane("a", "/r"), pane("b", "/r"), pane("c", "/r")]);
  assert.equal(shared.size, 3);
});

test("格子の名前は窓の数を写す", () => {
  assert.equal(paneGridClass(1), "pane-grid pane-grid-1");
  assert.equal(paneGridClass(2), "pane-grid pane-grid-2");
  assert.equal(paneGridClass(4), "pane-grid pane-grid-4");
});

test("窓の数が範囲外でも格子は壊れない", () => {
  // 0窓は起こらない想定（Go 側 PaneList が必ず1つ返す）だが、描画側が
  // 落ちる形にはしない — 画面が消えるより1窓に見える方がまだ直せる。
  assert.equal(paneGridClass(0), "pane-grid pane-grid-1");
  assert.equal(paneGridClass(9), "pane-grid pane-grid-4");
});
