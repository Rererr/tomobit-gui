import type { PaneId } from "../types";

interface SidebarProps {
  activePane: PaneId;
  onNewChat: () => void;
  onSelectPane: (pane: PaneId) => void;
}

export function Sidebar({ activePane, onNewChat, onSelectPane }: SidebarProps) {
  return (
    <aside className="sidebar">
      <button className="new-chat-btn" onClick={onNewChat}>
        + New chat
      </button>

      <div className="session-list">
        <p className="session-list-placeholder">セッションはまだありません</p>
      </div>

      <nav className="sidebar-footer">
        <button
          className={`sidebar-nav-item${activePane === "settings" ? " active" : ""}`}
          onClick={() => onSelectPane("settings")}
        >
          設定
        </button>
        <button
          className={`sidebar-nav-item${activePane === "memory" ? " active" : ""}`}
          onClick={() => onSelectPane("memory")}
        >
          メモリ
        </button>
      </nav>
    </aside>
  );
}
