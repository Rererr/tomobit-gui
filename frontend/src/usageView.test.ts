import test from "node:test";
import assert from "node:assert/strict";
import { QUOTA_TIGHT_PERCENT, quotaBarWidth, quotaTight, quotaWindowLabel } from "./usageView.ts";
import type { main } from "../wailsjs/go/models";

const win = (used: number, resetsAt = 0): main.QuotaWindow =>
  ({ label: "5h", used_percent: used, resets_at: resetsAt }) as main.QuotaWindow;

test("ゲージの幅は0〜100に収める（申告値が範囲外でも溝からはみ出さない）", () => {
  assert.equal(quotaBarWidth(0), 0);
  assert.equal(quotaBarWidth(42.4), 42.4);
  assert.equal(quotaBarWidth(140), 100);
  assert.equal(quotaBarWidth(-3), 0);
  assert.equal(quotaBarWidth(NaN), 0);
});

test("逼迫の線は1本だけ（閾値以上で色が変わる）", () => {
  assert.equal(quotaTight(QUOTA_TIGHT_PERCENT - 0.1), false);
  assert.equal(quotaTight(QUOTA_TIGHT_PERCENT), true);
  assert.equal(quotaTight(100), true);
});

test("右肩の表示は使用率、リセットが分かる枠だけ「あと…」を添える", () => {
  assert.equal(quotaWindowLabel(win(23)), "23%");
  // 端数は切り捨て: 4日半先なら「あと4日」— 残りを多めに言わない
  assert.equal(quotaWindowLabel(win(23.4, Date.now() + 4.5 * 86_400_000)), "23% ・あと4日");
});

test("ベンダーが言わなかったリセット時刻に「あと0分」を発明しない", () => {
  assert.equal(quotaWindowLabel(win(50, 0)), "50%");
  assert.equal(quotaWindowLabel(win(50, Date.now() - 1000)), "50%");
});
