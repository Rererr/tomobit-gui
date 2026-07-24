import test from "node:test";
import assert from "node:assert/strict";
import {
  formatGateNumber,
  gateLabel,
  gateState,
  gateTargetText,
  gateValueText,
} from "./growthView.ts";

test("value:null のゲートは未達ではなく測定不能になる", () => {
  assert.equal(gateState({ name: "sharpness", value: null, threshold: 0.2, met: false }), "unmeasurable");
  assert.equal(gateState({ name: "sharpness", threshold: 0.2, met: false }), "unmeasurable");
});

test("値があって閾値に届かないゲートは未達になる — 測定不能と同じ顔にしない", () => {
  assert.equal(gateState({ name: "sharpness", value: 0.49, threshold: 0.2, met: false }), "unmet");
  assert.equal(gateState({ name: "evidence", value: 0, threshold: 3, met: false }), "unmet");
});

test("充足したゲートはmet", () => {
  assert.equal(gateState({ name: "evidence", value: 22.1, threshold: 3, met: true }), "met");
});

test("測定不能のゲートは数値でなく「測定不能」と表示される", () => {
  assert.equal(gateValueText({ name: "sharpness", value: null, threshold: 0.2, met: false }), "測定不能");
});

test("測定できたゲートは値がそのまま表示される", () => {
  assert.equal(gateValueText({ name: "sharpness", value: 0.49, threshold: 0.2, met: false }), "0.49");
  assert.equal(gateValueText({ name: "evidence", value: 22.1, threshold: 3, met: true }), "22.1");
});

test("ゲート名は日本語ラベルに写り、未知の名前は本体の語をそのまま見せる", () => {
  assert.equal(gateLabel("connection"), "つながり");
  assert.equal(gateLabel("evidence"), "経験");
  assert.equal(gateLabel("calibration_sample"), "較正の標本");
  assert.equal(gateLabel("calibration"), "較正");
  assert.equal(gateLabel("sharpness"), "鋭さ");
  assert.equal(gateLabel("preference_with_human"), "あなたとの好み");
  assert.equal(gateLabel("future_gate"), "future_gate");
});

test("目標は床ゲートが「以上」・天井ゲートが「以下」で表される", () => {
  assert.equal(gateTargetText("connection", 1), "1以上");
  assert.equal(gateTargetText("evidence", 3), "3以上");
  assert.equal(gateTargetText("calibration_sample", 8), "8以上");
  assert.equal(gateTargetText("preference_with_human", 0.5), "0.5以上");
  assert.equal(gateTargetText("calibration", 0.15), "0.15以下");
  assert.equal(gateTargetText("sharpness", 0.2), "0.2以下");
});

test("未知のゲートは向きを知らないので数値だけ見せる", () => {
  assert.equal(gateTargetText("future_gate", 1.5), "1.5");
});

test("数値は末尾ゼロを引きずらず2桁に丸める", () => {
  assert.equal(formatGateNumber(22.104), "22.1");
  assert.equal(formatGateNumber(0.0712), "0.07");
  assert.equal(formatGateNumber(3), "3");
});
