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
