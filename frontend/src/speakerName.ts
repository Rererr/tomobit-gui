/**
 * 会話の名前行を出すか省くかの規則 (GUI ADR-0014 Decision 1)。
 *
 * ChatMessageView から切り出してあるのは、**規則がテストから読めるようにする**
 * ため —— あちらは React と JSX を import するので node --test が読めない
 * （reaction.ts / permission.ts と同じ配置理由）。ライブ (ChatPane) と過去の
 * 再生 (SessionPane) が同じ1つを通す。
 */
import type { ChatMessage } from "./types";

/** 名前行を持つ話者だけを区別する。note/system/stderr は「会話の脇からの声」で
 *  名前欄そのものを持たないため対象外——連続判定の外に置く。挟まると必ず
 *  名前が出し直される（Slack で参加通知が挟まると連続がリセットされるのと同じ）。 */
function speakerOf(message: ChatMessage): "user" | "turn" | undefined {
  return message.kind === "user" || message.kind === "turn" ? message.kind : undefined;
}

/**
 * 連続の何件ごとに名前を出し直すか。
 *
 * Slack は「時間が空いたら出し直す」が、view ストリームはターンの時刻を持たない
 * （ADR-0014「却下: 時刻を出す」）。持っていない事実を器の都合で発明しないまま
 * 同じ効果を得るために、**時間の代わりに件数**で切る。
 *
 * 2 にしてあるのは、名前を出さない枠が続くのを**高々1件**に抑えられる最大の値
 * だからである。3 以上にすると名前無しの枠が2件以上並び、**1枠が画面より高い
 * とき**（Tomo の長い返答では普通に起きる）に画面から "You" も "Tomo" も
 * 消える —— Tomo が3連続で返した中間位置で実際に再現した状態がそのまま残る。
 * user と turn の本文色は同じなので、その状態には手がかりが1つも無い。
 */
export const SPEAKER_NAME_REPEAT_EVERY = 2;

/**
 * messages[index] の名前行を省いてよいか（ADR-0014 Decision 1: 連続する
 * 同じ話者では名前行を目からは省く。ただし SPEAKER_NAME_REPEAT_EVERY 件ごとに
 * 出し直す）。
 *
 * Why not: MessageView は1メッセージだけを見て描く memo 済みコンポーネント
 * （2026-07-26 の応答停止修正——ストリームが動かす最後の1ターン以外を毎フレーム
 * 再計算しないための境界）。前後関係を知るために MessageView 自身に配列を
 * 持たせると、この境界を壊して全件再描画に戻る。呼び出し側（ChatPane /
 * SessionPane）は元々 .map() で配列を1回舐めており、その場で前の要素を覗くのは
 * 追加コストではない——ここで作るのは boolean 1つで、確定済みメッセージでは
 * 前後関係が変わらない限り値も変わらないので、shallow compare な memo はそのまま効く。
 *
 * 連続の位置を数えるために後ろへ遡るが、遡る距離は**同じ話者が続いている長さ**
 * までで、比較は kind 1つ。話者は You と Tomo が交互に出るので実際には数件で
 * 止まる（連続が長い時だけ長く遡る、という素直な比例）。
 */
export function sameSpeakerAsPrevious(messages: ChatMessage[], index: number): boolean {
  const speaker = speakerOf(messages[index]);
  if (speaker === undefined || index === 0) {
    return false;
  }
  if (speakerOf(messages[index - 1]) !== speaker) {
    return false;
  }
  let run = 0;
  for (let i = index - 1; i >= 0 && speakerOf(messages[i]) === speaker; i--) {
    run += 1;
  }
  return run % SPEAKER_NAME_REPEAT_EVERY !== 0;
}
