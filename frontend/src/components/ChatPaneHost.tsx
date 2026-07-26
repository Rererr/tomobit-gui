import { ChatPane } from "./ChatPane";
import { ClosingDialog } from "./ClosingDialog";
import { WorkspaceBar } from "./WorkspaceBar";
import { RunCommandProvider } from "./RunCommandProvider";
import { RunCommand } from "../../wailsjs/go/main/App";
import { useChatSession } from "../useChatSession";
import type { main } from "../../wailsjs/go/models";

interface ChatPaneHostProps {
  pane: main.PaneConfig;
  /** この窓が閉じられるか。最後の1窓には×を出さない — 会話面が0個の GUI は
   *  ただ壊れて見える（Go 側 ClosePane も同じ理由で断る）。 */
  closable: boolean;
  /** 同じ場所で働くもう1つの窓があるか (ADR-0009 Decision 6)。判断ではなく観測。 */
  sharesPlace: boolean;
  /** 実行ボタン (ADR-0007) の同意。Tomo 一匹ぶんの設定なので App が配る。 */
  runCommandEnabled: boolean;
  onLedgerChange: () => void;
  onWorkspaceChange: (pane: string, workingDir: string, readDirs: string[]) => Promise<string | null>;
  onClose: (pane: string) => void;
  /** この窓の締めが終わった（chat:exit）。App はここで初めて窓を畳む —
   *  器官が答えを聞き終える前に画面ごと消さないため。 */
  onExited: (pane: string) => void;
}

/**
 * ChatPaneHost は「1つの窓」。
 *
 * 窓ごとに1回ずつ useChatSession を呼ぶために、窓はコンポーネントである必要が
 * ある — フックは呼ぶ順序が固定でなければならないので、App の中でループして
 * 呼ぶことはできない。窓を1つのコンポーネントにすると、その制約が設計と一致する:
 * **窓が生まれたり消えたりすることは、会話が生まれたり消えたりすることそのもの**。
 *
 * 締めのダイアログもここに置く (ADR-0009 Decision 4)。窓の中に出るので、他の窓は
 * 動き続ける。
 */
export function ChatPaneHost({
  pane,
  closable,
  sharesPlace,
  runCommandEnabled,
  onLedgerChange,
  onWorkspaceChange,
  onClose,
  onExited,
}: ChatPaneHostProps) {
  const chat = useChatSession(pane.id, onLedgerChange, () => onExited(pane.id));

  async function handleWorkspaceChange(workingDir: string, readDirs: string[]) {
    const note = await onWorkspaceChange(pane.id, workingDir, readDirs);
    if (note !== null) {
      chat.appendSystem(note);
    }
  }

  async function handleClose() {
    // 窓を閉じる = その窓のセッションを区切る (ADR-0009 Decision 4)。締めが
    // 走り始めたら畳むのは chat:exit の後 — 器官が答えを聞き終える前に
    // 画面ごと消すと、ADR-0005 が直したはずの「答えられない締め」に戻る。
    onClose(pane.id);
  }

  return (
    // 実行ボタンの作業ディレクトリは窓のもの (ADR-0009 Decision 3)。同意 (enabled)
    // は Tomo 一匹ぶんの設定で、走る場所だけが窓ごとに違う。
    <RunCommandProvider
      value={{ enabled: runCommandEnabled, workingDir: pane.working_dir ?? "", run: RunCommand }}
    >
      <section className="chat-pane-host">
        {closable && (
          <button
            className="chat-pane-close"
            onClick={() => void handleClose()}
            title="この窓を区切って閉じる"
            aria-label="この窓を閉じる"
          >
            ×
          </button>
        )}
        <ChatPane
          messages={chat.messages}
          activity={chat.activity}
          onSend={chat.send}
          allowEmptySend={chat.boundaryActive}
          workspace={
            <>
              {/* 判断はしないが、観測は言う (ADR-0009 Decision 6)。禁止も
                  モーダルも出さない — 食い違いを黙って作らないための1行。 */}
              {sharesPlace && (
                <p className="chat-pane-shared-place">
                  この窓は、もう1つの窓と同じ場所で働いている
                </p>
              )}
              <WorkspaceBar
                workingDir={pane.working_dir ?? ""}
                readDirs={pane.read_dirs ?? []}
                onChange={(dir, dirs) => void handleWorkspaceChange(dir, dirs)}
                onError={chat.appendSystem}
              />
            </>
          }
        />
        {chat.closing && (
          <ClosingDialog
            question={chat.closingQuestion}
            notes={chat.closingNotes}
            onAnswer={chat.answerClosing}
            onAbandon={chat.abandonBoundary}
          />
        )}
      </section>
    </RunCommandProvider>
  );
}
