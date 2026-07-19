import { useEffect, useState } from "react";
import { GetMemoryView } from "../../wailsjs/go/main/App";
import type { main } from "../../wailsjs/go/models";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; view: main.MemoryView }
  | { kind: "error"; message: string };

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

// formatKV flattens a JSON object's own keys into "k=v" pairs — enough of a
// gist for context/payload blobs whose shape varies by kind/signal (SCHEMA.md
// D7); the raw text is shown as a fallback if it is not an object.
function formatKV(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return raw;
    }
    const parts = Object.entries(parsed as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`);
    return parts.length > 0 ? parts.join(" ") : "(空)";
  } catch {
    return raw;
  }
}

// summarizeOutcome keeps only the signals that fired (core.Outcome, ADR-0003):
// a true boolean prints its key alone (e.g. "failed"), everything else as
// "k=v"; false/empty/absent fields carry no information and are dropped.
function summarizeOutcome(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return raw;
    }
    const parts: string[] = [];
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === false || v === "" || v === null || v === undefined) {
        continue;
      }
      parts.push(v === true ? k : `${k}=${String(v)}`);
    }
    return parts.length > 0 ? parts.join(" ") : "(記録なし)";
  } catch {
    return raw;
  }
}

// connectionStrength derives the display numbers from the decaying Beta
// posterior (internal/core/beta.go): mean = alpha/(alpha+beta), and the
// evidence actually accumulated is alpha+beta minus what the prior already
// carried before any experience landed.
function connectionStrength(c: main.Connection): { percent: number; n: number } {
  const percent = Math.round((c.alpha / (c.alpha + c.beta)) * 100);
  const n = Math.max(0, c.alpha + c.beta - c.prior_alpha - c.prior_beta);
  return { percent, n };
}

export function MemoryPane() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  async function load() {
    setState({ kind: "loading" });
    try {
      const view = await GetMemoryView();
      setState({ kind: "loaded", view });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="memory-pane">
      <div className="memory-header">
        <h2>メモリ</h2>
        <button className="memory-refresh-btn" onClick={() => void load()} disabled={state.kind === "loading"}>
          更新
        </button>
      </div>

      {state.kind === "loading" && <p className="memory-status">読み込み中…</p>}
      {state.kind === "error" && (
        <p className="memory-status memory-status--error">読み込みに失敗: {state.message}</p>
      )}

      {state.kind === "loaded" && !state.view.exists && (
        <p className="memory-empty-ledger">
          台帳がまだ無い（{state.view.db_path}）— チャットで話しかけると積まれ始める
        </p>
      )}

      {state.kind === "loaded" && state.view.exists && (
        <>
          <section className="memory-section">
            <h3>Tomoの理解</h3>
            {state.view.connections.length === 0 ? (
              <p className="memory-section-empty">まだ何も学んでいない</p>
            ) : (
              <ul className="memory-list">
                {state.view.connections.map((c) => {
                  const { percent, n } = connectionStrength(c);
                  return (
                    <li key={`${c.kind}:${c.scope_key}:${c.target}`} className="memory-item">
                      <div className="memory-item-title">
                        {c.scope_key} → {c.target} <span className="memory-item-kind">({c.kind})</span>
                      </div>
                      <div
                        className="memory-item-detail"
                        title="強さ = 成功率の推定（α/(α+β)）／経験量 = 事前分を除いた観測の蓄積（α+β−事前）。時間で減衰する"
                      >
                        強さ {percent}% ・経験量 {n.toFixed(1)} ・更新 {formatDate(c.last_update)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="memory-section">
            <h3>積んだ経験</h3>
            {state.view.experiences.length === 0 ? (
              <p className="memory-section-empty">まだ経験が無い</p>
            ) : (
              <ul className="memory-list">
                {state.view.experiences.map((e) => (
                  <li key={e.id} className="memory-item">
                    <div className="memory-item-title">
                      {formatDate(e.ts)} ・{e.kind}
                      {e.provider !== "" ? ` ・${e.provider}` : ""}
                    </div>
                    <div className="memory-item-detail">{formatKV(e.context)}</div>
                    <div className="memory-item-detail">{summarizeOutcome(e.outcome)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="memory-section">
            <h3>気になっていること</h3>
            {state.view.curiosity.length === 0 ? (
              <p className="memory-section-empty">今は気になっていることが無い</p>
            ) : (
              <ul className="memory-list">
                {state.view.curiosity.map((c) => (
                  <li key={c.id} className="memory-item">
                    <div className="memory-item-title">
                      {c.signal} ・優先度 {c.priority.toFixed(2)}
                    </div>
                    <div className="memory-item-detail">{formatKV(c.payload)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="memory-note">
            台帳の読み取り専用View — 記憶は会話から積まれる（編集・削除の器官はまだ無い）
          </p>
        </>
      )}
    </div>
  );
}
