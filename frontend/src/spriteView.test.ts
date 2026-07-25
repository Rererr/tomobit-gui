import test from "node:test";
import assert from "node:assert/strict";
import { bobOffset, headroom, overlayFor, stepBlink } from "./spriteView.ts";
import type { main } from "../wailsjs/go/models";

const anim = {
  blink_min_ms: 3000,
  blink_jitter_ms: 1000,
  blink_hold_ms: 180,
  bob_period_ms: 3200,
  bob_px: 1,
} as main.SpriteAnim;

test("呼吸は周期の後ろ半分だけ1px沈む", () => {
  assert.equal(bobOffset(0, anim), 0);
  assert.equal(bobOffset(1599, anim), 0);
  assert.equal(bobOffset(1600, anim), 1);
  assert.equal(bobOffset(3199, anim), 1);
  assert.equal(bobOffset(3200, anim), 0);
});

test("呼吸の周期が0の資産でも落ちない（沈まないだけ）", () => {
  assert.equal(bobOffset(1000, { ...anim, bob_period_ms: 0 } as main.SpriteAnim), 0);
});

test("瞬きは予定時刻でholdの間だけ立ち、次の予定はmin+jitterの先へ置かれる", () => {
  const start = { nextAtMs: 1000, untilMs: 0 };
  const before = stepBlink(999, start, anim, () => 0.5);
  assert.equal(before.blinking, false);
  assert.deepEqual(before.state, start);

  const fired = stepBlink(1000, start, anim, () => 0.5);
  assert.equal(fired.blinking, true);
  assert.equal(fired.state.untilMs, 1180);
  assert.equal(fired.state.nextAtMs, 1000 + 3000 + 500);

  const held = stepBlink(1179, fired.state, anim, () => 0.5);
  assert.equal(held.blinking, true);
  const done = stepBlink(1180, fired.state, anim, () => 0.5);
  assert.equal(done.blinking, false);
});

const sheet = {
  size: 32,
  stages: [
    { stage: 0, name: "毛玉", frames: [[], []], overlay_origin: { "?": [23, 3], z: [19, -1] } },
    { stage: 3, name: "わかもの", frames: [[], []], overlay_origin: { "?": [23, -6], z: [19, -10] } },
  ],
  overlays: [
    { marker: "?", rows: ["..dddd.."] },
    { marker: "z", rows: [".......mmmmm"] },
  ],
} as unknown as main.SpriteSheet;

test("気分記号は本体が配った座に置く（GUIは位置を計算しない）", () => {
  assert.deepEqual(overlayFor(sheet, 3, "z"), { rows: [".......mmmmm"], x: 19, y: -10 });
});

test("markerが空・未知なら記号は出さない", () => {
  assert.equal(overlayFor(sheet, 3, ""), null);
  assert.equal(overlayFor(sheet, 3, "!"), null);
});

test("資産が知らないステージを渡されても記号は出さない", () => {
  assert.equal(overlayFor(sheet, 5, "z"), null);
});

test("キャンバスの余白は全ステージ・全記号の最悪値（段が上がっても寸法が跳ねない）", () => {
  assert.equal(headroom(sheet), 10);
});
