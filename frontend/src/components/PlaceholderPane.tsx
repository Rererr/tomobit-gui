interface PlaceholderPaneProps {
  title: string;
}

export function PlaceholderPane({ title }: PlaceholderPaneProps) {
  return (
    <div className="placeholder-pane">
      <h2>{title}</h2>
      <p>準備中です。</p>
    </div>
  );
}
