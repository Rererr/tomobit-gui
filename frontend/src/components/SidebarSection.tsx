import type { ReactNode } from "react";

interface SidebarSectionProps {
  title: string;
  /** 見出しの右に添える小さい字（ステージ名など）。無ければ出さない */
  note?: string;
  hint?: string;
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  children: ReactNode;
}

/**
 * サイドバーの開閉式セクション (ADR-0006 Decision 1)。details/summary で組むのは
 * ヘッダの成長開示（GrowthDisclosure）と同じ作法 — 開閉はブラウザの器官に任せ、
 * GUIは畳み状態を覚えるだけ。
 *
 * 既定は開いた姿（本体ADR-0040 Decision 2 の「既定は畳む」とは逆）: これらは
 * 「常に見えるように」という要求で生えたセクションで、畳むのは人の選択。
 */
export function SidebarSection({ title, note, hint, collapsed, onToggle, children }: SidebarSectionProps) {
  return (
    <details
      className="sidebar-section"
      open={!collapsed}
      onToggle={(e) => onToggle(!(e.currentTarget as HTMLDetailsElement).open)}
    >
      {/* summary 直下を display:flex にすると開閉の▶マーカーが消える（成長開示で
          同じ罠を踏んだ）。中身を1枚 span で包み、マーカーは summary に残す */}
      <summary className="sidebar-section-head" title={hint}>
        <span className="sidebar-section-head-line">
          <span className="sidebar-section-title">{title}</span>
          {note !== undefined && note !== "" && <span className="sidebar-section-note">{note}</span>}
        </span>
      </summary>
      <div className="sidebar-section-body">{children}</div>
    </details>
  );
}
