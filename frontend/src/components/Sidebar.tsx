import { Fragment } from "react";
import type { main } from "../../wailsjs/go/models";
import type { PaneId } from "../types";
import { verdictMark } from "../verdict";
import { SidebarSection } from "./SidebarSection";
import { TomoPresence } from "./TomoPresence";
import { UsagePanel } from "./UsagePanel";

interface SidebarProps {
  activePane: PaneId;
  sessions: main.SessionDigest[];
  sessionsError: string | null;
  sessionsLoading: boolean;
  selectedSession: string | null;
  // Tomoの姿と利用状況は台帳/資産のView。取得に失敗していれば null で、
  // その場合セクションは黙って劣化する（ヘッダの局所劣化と同じ姿勢）。
  tomoStatus: main.TomoStatus | null;
  sprite: main.SpriteSheet | null;
  tomoCollapsed: boolean;
  usageCollapsed: boolean;
  onToggleTomo: (collapsed: boolean) => void;
  onToggleUsage: (collapsed: boolean) => void;
  onNewChat: () => void;
  onSelectPane: (pane: PaneId) => void;
  onSelectSession: (sessionID: string) => void;
}

function formatSessionDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// intentの表示用整形: 先頭のMarkdown見出し(#)・箇条書き(-/*/+)記号はタイトル
// としてはただのノイズ（実データで "### 未完了..." のような表示を確認した）。
// 本文の意味は変えない — 表示側だけの正規化で、台帳のintent自体は触らない。
function cleanIntent(intent: string): string {
  return intent.replace(/^(#{1,6}\s+|[-*+]\s+)/, "").trim();
}

// 一覧が伸びた時の見通し用の日付グループ見出し。並び順はバックエンドの返す
// 順序をそのまま使う（ここでは境界を検出するだけで再ソートはしない）。
function sessionDateGroupLabel(ms: number): string {
  // ローカルの暦日をUTC基点の日数に変換してから引き算する。ローカルのミリ秒
  // 差で割ると夏時間切り替え日（23h/25hの日）を跨いだ時に日数がずれるが、
  // UTC.Date.UTCへ写した時点でDSTの影響を受けない整数の「日数」になる。
  const dayIndex = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  const daysAgo = dayIndex(new Date()) - dayIndex(new Date(ms));
  if (daysAgo <= 0) {
    return "今日";
  }
  if (daysAgo === 1) {
    return "昨日";
  }
  if (daysAgo < 7) {
    return "今週";
  }
  return "それ以前";
}

// 状態の注記は目立つ例外だけ: finished が既定の姿なので書かない。
// 判定 (本体 ADR-0055) も同じ扱い — 置かれている方が例外なので印を出す。
// 置けるのは詳細からで、ここは「どれを判定したか」を思い出すための印だけ。
function sessionMeta(s: main.SessionDigest): string {
  const parts = [formatSessionDate(s.start_ts), `${s.turns}ターン`];
  if (s.status === "open") {
    parts.push("進行中");
  } else if (s.status === "cancelled") {
    parts.push("中止");
  }
  if (s.source === "learning") {
    parts.push("learning");
  }
  const mark = verdictMark(s.verdict);
  if (mark !== "") {
    parts.push(mark);
  }
  return parts.join(" ・");
}

export function Sidebar({
  activePane,
  sessions,
  sessionsError,
  sessionsLoading,
  selectedSession,
  tomoStatus,
  sprite,
  tomoCollapsed,
  usageCollapsed,
  onToggleTomo,
  onToggleUsage,
  onNewChat,
  onSelectPane,
  onSelectSession,
}: SidebarProps) {
  // 台帳が無ければ姿も出さない（ヘッダが素の「Tomo」に落ちるのと同じ判断:
  // 台帳が無いのに毛玉が居るとは言わない）。資産が取れない旧顔窓でも同じ。
  const stage = tomoStatus !== null && tomoStatus.exists ? tomoStatus.stage : null;
  const marker = tomoStatus?.mood?.marker ?? "";

  return (
    <aside className="sidebar">
      <button className="new-chat-btn" onClick={onNewChat}>
        + New chat
      </button>

      {/* 過去セッションのダイジェスト一覧 (ADR-0001 Consequences): 会話全文は
          台帳から再構成できないため、開いても要約表示に留まる */}
      <div className="session-list">
        {sessionsError !== null ? (
          <p className="session-list-placeholder">セッション一覧を読めない: {sessionsError}</p>
        ) : sessionsLoading ? (
          <p className="session-list-placeholder">読み込み中…</p>
        ) : sessions.length === 0 ? (
          <p className="session-list-placeholder">セッションはまだありません</p>
        ) : (
          (() => {
            let lastGroup: string | null = null;
            return sessions.map((s) => {
              const group = sessionDateGroupLabel(s.start_ts);
              const showGroupLabel = group !== lastGroup;
              lastGroup = group;
              const active = activePane === "session" && selectedSession === s.session_id;
              return (
                <Fragment key={s.session_id}>
                  {showGroupLabel && (
                    <div className="session-group-label" role="heading" aria-level={3}>
                      {group}
                    </div>
                  )}
                  <button
                    className={`session-item${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onSelectSession(s.session_id)}
                    title={cleanIntent(s.intent)}
                  >
                    <span className="session-item-intent">{cleanIntent(s.intent)}</span>
                    <span className="session-item-meta">{sessionMeta(s)}</span>
                  </button>
                </Fragment>
              );
            });
          })()
        )}
      </div>

      {/* ログ（過去セッション）とカテゴリ（下のnav）の間に、常に見えている
          2つのView (ADR-0006 Decision 1)。Tomoが上、利用状況が下 */}
      <SidebarSection
        title="Tomo"
        note={stage !== null ? (tomoStatus?.stage_name ?? "") : ""}
        hint="今のTomo — 姿もアニメも顔窓と同じ資産（本体 ADR-0048）"
        collapsed={tomoCollapsed}
        onToggle={onToggleTomo}
      >
        {sprite !== null && stage !== null ? (
          <TomoPresence sheet={sprite} stage={stage} marker={marker} />
        ) : (
          <p className="sidebar-section-empty">
            {stage === null ? "台帳がまだない" : "姿を読めない"}
          </p>
        )}
      </SidebarSection>

      <SidebarSection
        title="Usage"
        note="各Providerの申告値"
        hint="各Providerが自分の usage 端点で申告した使用率 — tomobit の保証ではない"
        collapsed={usageCollapsed}
        onToggle={onToggleUsage}
      >
        <UsagePanel quota={tomoStatus?.quota ?? []} unavailable={tomoStatus === null} />
      </SidebarSection>

      <nav className="sidebar-footer">
        {/* 区切りを宣言せずに会話へ戻る道。New chat は /exit を送るように
            なった(ADR-0001 追記)ので、これ無しではペイン切替が区切りを強いる */}
        <button
          className={`sidebar-nav-item${activePane === "chat" ? " active" : ""}`}
          aria-current={activePane === "chat" ? "page" : undefined}
          onClick={() => onSelectPane("chat")}
        >
          チャット
        </button>
        <button
          className={`sidebar-nav-item${activePane === "settings" ? " active" : ""}`}
          aria-current={activePane === "settings" ? "page" : undefined}
          onClick={() => onSelectPane("settings")}
        >
          設定
        </button>
        <button
          className={`sidebar-nav-item${activePane === "memory" ? " active" : ""}`}
          aria-current={activePane === "memory" ? "page" : undefined}
          onClick={() => onSelectPane("memory")}
        >
          メモリ
        </button>
      </nav>
    </aside>
  );
}
