// 姿の描き方 (ADR-0006 Decision 2 / 本体 ADR-0048)。資産もノブも本体
// `tomobit-face --view json` が配るので、ここが持つのは「配られた数字を
// 時刻に当てる」規則だけ — 顔窓 window.go Draw と同じ式を、同じ入力で解く。
//
// 規則を再導出しているのではなく写しているだけの箇所（気分記号の座）は
// 本体が計算済みの overlay_origin をそのまま使う。
import type { main } from "../wailsjs/go/models";

/** 1フレーム分の描画指示。canvas 側はこれを見て blit するだけ */
export interface SpriteFrame {
  /** 描くフレームの添字: 0=A(基本) / 1=B(瞬き) */
  frame: number;
  /** 呼吸の沈み込み（論理ピクセル） */
  bob: number;
}

/**
 * 呼吸 (window.go Draw): 周期の後ろ半分だけ1論理ピクセル沈む。整数だけを返すのは
 * 顔窓と同じ理由 — 非整数のずらしは nearest-neighbor の輪郭を滲ませる。
 */
export function bobOffset(elapsedMs: number, anim: main.SpriteAnim): number {
  const half = anim.bob_period_ms / 2;
  if (half <= 0) {
    return 0;
  }
  return Math.floor(elapsedMs / half) % 2 === 1 ? anim.bob_px : 0;
}

/** 瞬きのスケジュール。次に瞬く時刻と、瞬きを終える時刻を持つだけの小さな状態 */
export interface BlinkState {
  nextAtMs: number;
  untilMs: number;
}

/**
 * 瞬きを1目盛り進める (window.go Update/Draw)。nextAt を過ぎたら hold の間だけ
 * frame B にし、次の瞬きを min + [0, jitter) 先へ置く。乱数を引数に取るのは
 * テストのため — 顔窓側は rand.Int63n。
 */
export function stepBlink(
  nowMs: number,
  state: BlinkState,
  anim: main.SpriteAnim,
  random: () => number,
): { state: BlinkState; blinking: boolean } {
  let next = state;
  if (nowMs >= state.nextAtMs) {
    next = {
      untilMs: nowMs + anim.blink_hold_ms,
      nextAtMs: nowMs + anim.blink_min_ms + Math.floor(random() * anim.blink_jitter_ms),
    };
  }
  return { state: next, blinking: nowMs < next.untilMs };
}

/**
 * 気分記号を出す先。marker が空、資産がその記号を知らない、その組み合わせの
 * 座が無い — どれも「出さない」。知らない marker を勝手な位置に描くよりは、
 * 顔窓と同じく素の姿で居るほうが正直（本体が marker を増やしても壊れない）。
 */
export function overlayFor(
  sheet: main.SpriteSheet,
  stage: number,
  marker: string,
): { rows: string[]; x: number; y: number } | null {
  if (marker === "") {
    return null;
  }
  const ov = sheet.overlays?.find((o) => o.marker === marker);
  const st = sheet.stages?.find((s) => s.stage === stage);
  if (!ov || !st) {
    return null;
  }
  const origin = st.overlay_origin?.[marker];
  if (!origin || origin.length < 2) {
    return null;
  }
  return { rows: ov.rows, x: origin[0], y: origin[1] };
}

/**
 * 気分記号が頭の上へどれだけはみ出すか（論理ピクセル）。canvas の高さを
 * 決めるのに要る。全ステージ・全記号の最悪値を取るのは、ステージが上がった
 * 瞬間にキャンバスの寸法が変わって画面が跳ねるのを避けるため。
 */
export function headroom(sheet: main.SpriteSheet): number {
  let worst = 0;
  for (const st of sheet.stages ?? []) {
    for (const [, origin] of Object.entries(st.overlay_origin ?? {})) {
      if (origin.length >= 2 && -origin[1] > worst) {
        worst = -origin[1];
      }
    }
  }
  return worst;
}
