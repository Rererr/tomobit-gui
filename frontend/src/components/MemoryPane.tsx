import { useEffect, useRef, useState } from "react";
import { AmendExperience, ForgetExperiences, GetMemoryView } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { errorMessage } from "../errorMessage";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; view: main.MemoryView }
  | { kind: "error"; message: string };

/** 経験1行に対する進行中の操作。開けるのは同時に1行だけ — 訂正も忘却も
 * 台帳の外科手術（本体ADR-0033）で、並べて積む類の操作ではない */
type RowAction =
  | { kind: "confirm-forget"; id: string }
  | { kind: "editing"; id: string; context: string; outcome: string; provider: string }
  | { kind: "busy"; id: string };

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

/** target(Provider・好みペア)単位の集約 — 複数Provider運用では同じ文脈が
 * Providerの数だけ行を生むので、行の主はtargetにする。バックエンドは
 * last_update降順で返すため、グループ順・グループ内順もそのまま新しい順 */
interface ConnGroup {
  kind: string;
  target: string;
  conns: main.Connection[];
}

function groupConnections(conns: main.Connection[]): ConnGroup[] {
  const groups = new Map<string, ConnGroup>();
  for (const c of conns) {
    const key = `${c.kind}:${c.target}`;
    let g = groups.get(key);
    if (g === undefined) {
      g = { kind: c.kind, target: c.target, conns: [] };
      groups.set(key, g);
    }
    g.conns.push(c);
  }
  return [...groups.values()];
}

function groupSummary(g: ConnGroup): string {
  const percents = g.conns.map((c) => connectionStrength(c).percent);
  const min = Math.min(...percents);
  const max = Math.max(...percents);
  const range = min === max ? `${min}%` : `${min}〜${max}%`;
  return `文脈 ${g.conns.length}件 ・強さ ${range}`;
}

/** 空スコープ("")は全文脈に効く既定 — 空文字のまま出すと欠けに見える */
function scopeLabel(scopeKey: string): string {
  return scopeKey === "" ? "(すべての文脈)" : scopeKey;
}

function includesCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function matchesConnection(c: main.Connection, search: string, kinds: Set<string>): boolean {
  if (kinds.size > 0 && !kinds.has(c.kind)) {
    return false;
  }
  return search === "" || [c.kind, c.target, c.scope_key].some((f) => includesCI(f, search));
}

// experienceSearchText/curiositySearchText はペイン表示文字列そのものを検索対象にする
// — 生のJSONではなくユーザーが実際に読んでいる要約(formatKV/summarizeOutcome)に一致させる
function experienceSearchText(e: main.Experience): string {
  return [e.kind, e.provider, formatKV(e.context), summarizeOutcome(e.outcome)].join(" ");
}

function curiositySearchText(c: main.CuriosityItem): string {
  return [c.signal, formatKV(c.payload)].join(" ");
}

function sectionCount(matched: number, total: number): string {
  return `${matched}/${total}件`;
}

export function MemoryPane() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [action, setAction] = useState<RowAction | null>(null);
  const [writeStatus, setWriteStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // 検索・kind絞り込みはViewの一時的な操作 — 台帳を書き換えないため永続化しない
  // （ペインを離れて再訪すれば白紙に戻る。設定ではなく視線の絞り方）
  const [searchText, setSearchText] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<Set<string>>(new Set());
  // 行内フォームを開く「訂正」/「忘れる」ボタン（行id + 種別で引ける）。開いた
  // 瞬間に対象行の訂正/忘れるボタン自体はアンマウントされる（同じ場所に確認/
  // 編集UIが差し替わる）ため、クリック時点の要素をrefで覚えても閉じた後には
  // 既に外れたDOMノードになっている。Mapに都度登録し、閉じる瞬間に
  // action.id+kindで引き直すことで、再マウントされた新しいボタンへ戻す。
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  // フォームを開いたボタンのkey。busy（書き込み中）を経てnullに落ちても
  // busyにはkind情報が無いため、開いた瞬間だけここへ覚えておく。
  const lastTriggerKeyRef = useRef<string | null>(null);
  // 開いたフォームの最初の操作対象（confirm-forgetは「やめる」、editingは
  // 最初のtextarea）。破壊的操作をEnterで誤爆させないよう、危険な方ではなく
  // 安全な方へ既定フォーカスを置く。
  const firstFieldRef = useRef<HTMLElement | null>(null);

  function triggerKey(kind: "editing" | "confirm-forget", id: string): string {
    return `${kind}:${id}`;
  }

  function registerTrigger(key: string) {
    return (el: HTMLButtonElement | null) => {
      if (el) {
        triggerRefs.current.set(key, el);
      }
    };
  }

  // フォームの開閉でフォーカスを追従させる。busy中は書き込みの最中なので
  // フォーカスを奪わない（次のnullへの遷移で行き先が決まる）。
  useEffect(() => {
    if (action === null) {
      const key = lastTriggerKeyRef.current;
      if (key !== null) {
        triggerRefs.current.get(key)?.focus();
      }
    } else if (action.kind !== "busy") {
      lastTriggerKeyRef.current = triggerKey(action.kind, action.id);
      firstFieldRef.current?.focus();
    }
  }, [action]);

  async function load() {
    setState({ kind: "loading" });
    try {
      const view = await GetMemoryView();
      setState({ kind: "loaded", view });
    } catch (err) {
      setState({ kind: "error", message: errorMessage(err) });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Escapeで行内の確認・編集を閉じる。busyは進行中の書き込みなので対象外
  // （キャンセル手段が無い＝閉じても実体は止まらず、閉じると空振りに見える）。
  useEffect(() => {
    if (action === null || action.kind === "busy") {
      return;
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAction(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [action]);

  /** 書き込み1回の共通後始末: 成功はサマリ表示 + 再読込（rebuild後の台帳を
   * 見せる）、失敗は本体CLIの検証文言をそのまま見せる — GUIは言い換えない */
  async function runWrite(op: () => Promise<main.WriteResult>) {
    try {
      const res = await op();
      setWriteStatus({ ok: true, text: res.notice !== "" ? `${res.summary}（${res.notice}）` : res.summary });
      setAction(null);
      await load();
    } catch (err) {
      setWriteStatus({ ok: false, text: errorMessage(err) });
      setAction(null);
    }
  }

  function toggleKind(kind: string) {
    setSelectedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }

  function clearFilter() {
    setSearchText("");
    setSelectedKinds(new Set());
  }

  async function forgetOne(id: string) {
    setAction({ kind: "busy", id });
    await runWrite(() => ForgetExperiences([id]));
  }

  async function saveAmend(e: main.Experience, d: { context: string; outcome: string; provider: string }) {
    const req = new main.AmendRequest({
      id: e.id,
      set_context: d.context !== e.context,
      context: d.context,
      set_outcome: d.outcome !== e.outcome,
      outcome: d.outcome,
      set_provider: d.provider !== e.provider,
      provider: d.provider,
    });
    if (!req.set_context && !req.set_outcome && !req.set_provider) {
      setWriteStatus({ ok: true, text: "変更なし — 何も送っていない" });
      setAction(null);
      return;
    }
    setAction({ kind: "busy", id: e.id });
    await runWrite(() => AmendExperience(req));
  }

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
      {writeStatus !== null && (
        <p className={writeStatus.ok ? "memory-status" : "memory-status memory-status--error"}>
          {writeStatus.text}
        </p>
      )}

      {state.kind === "loaded" && !state.view.exists && (
        <p className="memory-empty-ledger">
          台帳がまだ無い（{state.view.db_path}）— チャットで話しかけると積まれ始める
        </p>
      )}

      {state.kind === "loaded" && state.view.exists && (() => {
        const kindOptions = [...new Set(state.view.connections.map((c) => c.kind))].sort();
        const filteredConnections = state.view.connections.filter((c) =>
          matchesConnection(c, searchText, selectedKinds),
        );
        const filteredExperiences = state.view.experiences.filter(
          (e) => searchText === "" || includesCI(experienceSearchText(e), searchText),
        );
        const filteredCuriosity = state.view.curiosity.filter(
          (c) => searchText === "" || includesCI(curiositySearchText(c), searchText),
        );
        const filterActive = searchText !== "" || selectedKinds.size > 0;

        return (
        <>
          <div className="memory-filter-bar">
            <label className="memory-filter-label" htmlFor="memory-search-input">
              検索
            </label>
            <input
              id="memory-search-input"
              className="memory-filter-input"
              value={searchText}
              placeholder="scope・target・kind・内容で絞り込み"
              aria-label="メモリを検索"
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && searchText !== "") {
                  e.stopPropagation();
                  setSearchText("");
                }
              }}
            />
            {filterActive && (
              <button className="memory-filter-clear-btn" onClick={clearFilter}>
                クリア
              </button>
            )}
          </div>

          {kindOptions.length > 0 && (
            <div className="memory-filter-chips" role="group" aria-label="kindで絞り込み">
              {kindOptions.map((kind) => {
                const pressed = selectedKinds.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    className={pressed ? "memory-filter-chip memory-filter-chip--active" : "memory-filter-chip"}
                    aria-pressed={pressed}
                    onClick={() => toggleKind(kind)}
                  >
                    {kind}
                  </button>
                );
              })}
            </div>
          )}

          <section className="memory-section">
            <div className="memory-section-header">
              <h3>Tomoの理解</h3>
              <span className="memory-section-count">
                {sectionCount(filteredConnections.length, state.view.connections.length)}
              </span>
            </div>
            {state.view.connections.length === 0 ? (
              <p className="memory-section-empty">まだ何も学んでいない</p>
            ) : filteredConnections.length === 0 ? (
              <p className="memory-section-empty">該当なし</p>
            ) : (
              (() => {
                const groups = groupConnections(filteredConnections);
                // グループが少ないうちは畳む理由が無い。増えたら summary の
                // 集約値だけで見通し、必要な target を開く
                const open = groups.length <= 2;
                return groups.map((g) => (
                  <details key={`${g.kind}:${g.target}`} className="memory-group" open={open}>
                    <summary className="memory-group-summary">
                      <span className="memory-item-title">
                        {g.target} <span className="memory-item-kind">({g.kind})</span>
                      </span>
                      <span className="memory-group-stats">{groupSummary(g)}</span>
                    </summary>
                    <ul className="memory-list">
                      {g.conns.map((c) => {
                        const { percent, n } = connectionStrength(c);
                        return (
                          <li key={`${c.scope_key}`} className="memory-item">
                            <div className="memory-item-title">{scopeLabel(c.scope_key)}</div>
                            <div className="memory-strength-bar" title={`強さ ${percent}%`}>
                              <div className="memory-strength-bar-fill" style={{ width: `${percent}%` }} />
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
                  </details>
                ));
              })()
            )}
          </section>

          <section className="memory-section">
            <div className="memory-section-header">
              <h3>積んだ経験</h3>
              <span className="memory-section-count">
                {sectionCount(filteredExperiences.length, state.view.experiences.length)}
              </span>
            </div>
            {state.view.experiences.length === 0 ? (
              <p className="memory-section-empty">まだ経験が無い</p>
            ) : filteredExperiences.length === 0 ? (
              <p className="memory-section-empty">該当なし</p>
            ) : (
              <ul className="memory-list">
                {filteredExperiences.map((e) => {
                  const rowAction = action !== null && action.id === e.id ? action : null;
                  return (
                    <li key={e.id} className="memory-item">
                      <div className="memory-item-title">
                        {formatDate(e.ts)} ・{e.kind}
                        {e.provider !== "" ? ` ・${e.provider}` : ""}
                      </div>
                      <div className="memory-item-detail">{formatKV(e.context)}</div>
                      <div className="memory-item-detail">{summarizeOutcome(e.outcome)}</div>

                      {rowAction === null && (
                        <div className="memory-item-actions">
                          <button
                            ref={registerTrigger(triggerKey("editing", e.id))}
                            className="memory-act-btn"
                            disabled={action !== null}
                            onClick={() =>
                              setAction({
                                kind: "editing",
                                id: e.id,
                                context: e.context,
                                outcome: e.outcome,
                                provider: e.provider,
                              })
                            }
                          >
                            訂正
                          </button>
                          <button
                            ref={registerTrigger(triggerKey("confirm-forget", e.id))}
                            className="memory-act-btn"
                            disabled={action !== null}
                            onClick={() => setAction({ kind: "confirm-forget", id: e.id })}
                          >
                            忘れる
                          </button>
                        </div>
                      )}

                      {rowAction?.kind === "confirm-forget" && (
                        <div className="memory-item-actions">
                          <span className="memory-confirm-text">物理削除する — 取り消せない</span>
                          <button
                            className="memory-act-btn memory-act-btn--danger"
                            onClick={() => void forgetOne(e.id)}
                          >
                            忘れる
                          </button>
                          <button
                            ref={(el) => {
                              firstFieldRef.current = el;
                            }}
                            className="memory-act-btn"
                            onClick={() => setAction(null)}
                          >
                            やめる
                          </button>
                        </div>
                      )}

                      {rowAction?.kind === "editing" && (
                        <div className="memory-edit-form">
                          <label className="memory-edit-label">
                            context（JSONオブジェクト・全置換）
                            <textarea
                              ref={(el) => {
                                firstFieldRef.current = el;
                              }}
                              className="memory-edit-input"
                              rows={2}
                              value={rowAction.context}
                              onChange={(ev) => setAction({ ...rowAction, context: ev.target.value })}
                            />
                          </label>
                          <label className="memory-edit-label">
                            outcome（JSON・全置換）
                            <textarea
                              className="memory-edit-input"
                              rows={2}
                              value={rowAction.outcome}
                              onChange={(ev) => setAction({ ...rowAction, outcome: ev.target.value })}
                            />
                          </label>
                          {e.kind === "execution" && (
                            <label className="memory-edit-label">
                              provider
                              <input
                                className="memory-edit-input"
                                value={rowAction.provider}
                                onChange={(ev) => setAction({ ...rowAction, provider: ev.target.value })}
                              />
                            </label>
                          )}
                          <p className="memory-edit-note">
                            訂正は削除ではなく追記（人間による再知覚）。検証は本体が行い、
                            不正なJSON・未知のkey/providerは拒否される
                          </p>
                          <div className="memory-item-actions">
                            <button className="memory-act-btn" onClick={() => void saveAmend(e, rowAction)}>
                              訂正を保存
                            </button>
                            <button className="memory-act-btn" onClick={() => setAction(null)}>
                              やめる
                            </button>
                          </div>
                        </div>
                      )}

                      {rowAction?.kind === "busy" && (
                        <p className="memory-status">実行中…（rebuildが終わるまで待つ）</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="memory-section">
            <div className="memory-section-header">
              <h3>気になっていること</h3>
              <span className="memory-section-count">
                {sectionCount(filteredCuriosity.length, state.view.curiosity.length)}
              </span>
            </div>
            {state.view.curiosity.length === 0 ? (
              <p className="memory-section-empty">今は気になっていることが無い</p>
            ) : filteredCuriosity.length === 0 ? (
              <p className="memory-section-empty">該当なし</p>
            ) : (
              <ul className="memory-list">
                {filteredCuriosity.map((c) => (
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
            読みは台帳の読み取り専用View。訂正・忘却は本体の忘却の器官（tomobit amend /
            forget）を経由する。セッション単位の完全忘却（生ログごと消す）はCLIの
            `tomobit forget --session` で
          </p>
        </>
        );
      })()}
    </div>
  );
}
