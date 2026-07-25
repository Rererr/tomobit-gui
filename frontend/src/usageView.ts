// Provider別の利用と残量の表示用整形 (ADR-0006)。値そのものは本体
// `status --view json` が配る観測値で、ここは丸めと言い回しだけを持つ —
// 集計・正規化は本体だけが担う（stage.go のコメントと同じ境界）。
//
// MemoryPane から出してモジュールにしたのは、同じ整形をサイドバーの Usage
// セクションが使うため。二箇所に同じ丸めを書けば、片方だけ直った日に
// 「同じ数字が違って見える」が生まれる。
import type { main } from "../wailsjs/go/models";

/** 「最終利用」の相対表記。経験一覧は絶対時刻のままなので、これは利用実績専用 */
export function formatRelativeTime(ms: number): string {
  if (ms <= 0) {
    return "-";
  }
  const diff = Date.now() - ms;
  if (diff < 60_000) {
    return "たった今";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}分前`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}時間前`;
  }
  return `${Math.floor(diff / 86_400_000)}日前`;
}

// providerUsageDetail は1行のProvider利用実績を「回数・成功率・最終利用」に
// 圧縮する。scored=0(結果の信号が読めた実行が無い)は成功率を「-」にする —
// 母数0の平均を出すと0%の失敗と見分けが付かない。
export function providerUsageDetail(p: main.ProviderUsage): string {
  const successText = p.scored > 0 ? `成功率 ${Math.round(p.success * 100)}%` : "成功率 -";
  return `${p.runs}回 ・ ${successText} ・ 最終 ${formatRelativeTime(p.last_ts)}`;
}

// formatResetTime は残量枠のリセットまでの相対表記。0・過去は空文字 —
// ベンダーが言わなかった枠(resets_at=0)に「あと0分」を発明しない
// (本体 cmd の relativeResetTime と同じ姿勢、本体 ADR-0044 Decision 5)。
export function formatResetTime(ms: number): string {
  if (ms <= 0) {
    return "";
  }
  const diff = ms - Date.now();
  if (diff <= 0) {
    return "";
  }
  if (diff < 3_600_000) {
    return `あと${Math.floor(diff / 60_000)}分`;
  }
  if (diff < 86_400_000) {
    return `あと${Math.floor(diff / 3_600_000)}時間`;
  }
  return `あと${Math.floor(diff / 86_400_000)}日`;
}

// quotaBarWidth はゲージの塗り幅(%)。表示する数字は丸めるだけで加工しないが、
// 幅だけは 0–100 に収める — ベンダーが 100 を超える値や負値を返しても、
// 溝からはみ出したバーはただの描画の壊れであって情報ではない。
export function quotaBarWidth(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, usedPercent));
}

// quotaTight は「そろそろ気にしたほうがいい」の1本の線。強さバー
// (memory-strength-bar) が評価色を付けないのと姿勢を変えるのは、量の意味が
// 違うため: 強さは低くても悪ではない推定値だが、残量は使い切れば止まる有限の
// 予算で、8割は事実として注意に値する。閾値はここ1箇所だけに置く。
export const QUOTA_TIGHT_PERCENT = 80;

export function quotaTight(usedPercent: number): boolean {
  return usedPercent >= QUOTA_TIGHT_PERCENT;
}

// quotaWindowLabel は1枠の右肩に出す「使用率（あとどれだけ）」。
// resets_at=0（ベンダーが言わなかった）に「あと0分」を発明しない。
export function quotaWindowLabel(w: main.QuotaWindow): string {
  const reset = formatResetTime(w.resets_at ?? 0);
  const used = `${Math.round(w.used_percent)}%`;
  return reset !== "" ? `${used} ・${reset}` : used;
}
