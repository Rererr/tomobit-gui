// task.finished/task.cancelled（chat:view の NDJSON）と chat:exit（子プロセス
// 終了）は /exit 経由の境界では同一の出来事の2つの観測（本体 cmd/tomobit
// chat.go closeTask: finishTask 完了後に task.finished を発光し、その直後に
// プロセスが終了する）。それぞれが素朴に台帳の読み直しを呼ぶと、`tomobit
// status` の2重起動でSQLite migrationロックを踏む（実測: database is locked
// (261)）。React コンポーネントから切り離してテストできるよう、「1つの境界
// につき1回だけ実行を許す」合流ロジックだけをここに抜き出す。
export interface RefreshCoalescer {
  schedule(): void;
  cancel(): void;
}

// delayMs は2つの観測の実測ずれ（stdout読み切り + Wails IPCの往復、実測は
// 一桁〜数十ms）より十分に大きく、かつ「境界直後に一覧が更新される」体感を
// 損なわない程度（人には知覚できない背景更新の遅延）に選ぶ — ポーリングでは
// なくあくまで単発イベントの合流窓。
export function createRefreshCoalescer(run: () => void, delayMs: number): RefreshCoalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer !== null) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel() {
      if (timer === null) {
        return;
      }
      clearTimeout(timer);
      timer = null;
    },
  };
}
