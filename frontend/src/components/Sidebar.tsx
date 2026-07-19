import type { main } from "../../wailsjs/go/models";
import type { PaneId } from "../types";

interface SidebarProps {
  activePane: PaneId;
  sessions: main.SessionDigest[];
  sessionsError: string | null;
  selectedSession: string | null;
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

// 状態の注記は目立つ例外だけ: finished が既定の姿なので書かない。
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
  return parts.join(" ・");
}

export function Sidebar({
  activePane,
  sessions,
  sessionsError,
  selectedSession,
  onNewChat,
  onSelectPane,
  onSelectSession,
}: SidebarProps) {
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
        ) : sessions.length === 0 ? (
          <p className="session-list-placeholder">セッションはまだありません</p>
        ) : (
          sessions.map((s) => {
            const active = activePane === "session" && selectedSession === s.session_id;
            return (
              <button
                key={s.session_id}
                className={`session-item${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => onSelectSession(s.session_id)}
                title={s.intent}
              >
                <span className="session-item-intent">{s.intent}</span>
                <span className="session-item-meta">{sessionMeta(s)}</span>
              </button>
            );
          })
        )}
      </div>

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
