import type { main } from "../../wailsjs/go/models";
import { quotaBarWidth, quotaTight, quotaWindowLabel } from "../usageView";

interface UsagePanelProps {
  quota: main.QuotaStatus[];
  /** status の取得自体に失敗している（旧本体・台帳なし等）。理由は言わずに黙る */
  unavailable: boolean;
}

/**
 * 各Providerの残量 (ADR-0006 Decision 1・2026-07-25 改訂)。数字を読むのでなく
 * 「どれだけ残っているか」を一目で掴むためのゲージなので、枠1つ = バー1本。
 *
 * 値は各Providerが自分の usage 端点で申告したもので tomobit の保証ではない
 * （本体 ADR-0044）。観測できなかったProviderは 0% を発明せず「不明（理由）」
 * を出す（同 Decision 5）— **バーも引かない**: 空のバーは「たっぷり残っている」
 * と読めてしまい、0%を発明したのと同じ嘘になる。
 */
export function UsagePanel({ quota, unavailable }: UsagePanelProps) {
  if (unavailable || quota.length === 0) {
    return <p className="usage-empty">{unavailable ? "残量を読めない" : "残量を観測できていない"}</p>;
  }
  return (
    <div className="usage-panel">
      {quota.map((q) => (
        <div key={q.provider} className="usage-provider">
          <div className="usage-provider-name">{q.provider}</div>
          {q.windows && q.windows.length > 0 ? (
            q.windows.map((w) => (
              <div key={w.label} className="usage-gauge">
                <div className="usage-gauge-head">
                  <span className="usage-gauge-label">{w.label}</span>
                  <span className="usage-gauge-value">{quotaWindowLabel(w)}</span>
                </div>
                <div
                  className="usage-gauge-track"
                  role="meter"
                  aria-valuenow={Math.round(w.used_percent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${q.provider} ${w.label} の使用率`}
                >
                  <div
                    className={`usage-gauge-fill${quotaTight(w.used_percent) ? " tight" : ""}`}
                    style={{ width: `${quotaBarWidth(w.used_percent)}%` }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="usage-unknown">
              不明（{q.error && q.error.trim() !== "" ? q.error : "理由不明"}）
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
