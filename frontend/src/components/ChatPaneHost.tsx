import { useEffect, useRef } from "react";
import { ChatPane } from "./ChatPane";
import { PermissionDialog } from "./PermissionDialog";
import { WorkspaceBar } from "./WorkspaceBar";
import { RunCommandProvider } from "./RunCommandProvider";
import { RunCommand } from "../../wailsjs/go/main/App";
import { useChatSession } from "../useChatSession";
import { firstUserSay } from "../closingSheet";
import type { PaneClosing } from "../closingSheet";
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
  /** 締めの断面を App へ引き上げる (ADR-0012 Decision 1)。アプリの×の締めは
   *  窓ごとのモーダルではなく App 直下の1枚に集まるので、窓が担うのは自分の
   *  断面を渡すところまで。null は「この窓は締めていない」。 */
  onClosingState: (pane: string, closing: PaneClosing | null) => void;
}

/**
 * ChatPaneHost は「1つの窓」。
 *
 * 窓ごとに1回ずつ useChatSession を呼ぶために、窓はコンポーネントである必要が
 * ある — フックは呼ぶ順序が固定でなければならないので、App の中でループして
 * 呼ぶことはできない。窓を1つのコンポーネントにすると、その制約が設計と一致する:
 * **窓が生まれたり消えたりすることは、会話が生まれたり消えたりすることそのもの**。
 *
 * 権限の問いは窓の中に出る (本体 ADR-0053)。他の窓は動き続けるべきで、これは
 * その窓の Tomo が仕事を進めるために要るものだから。アプリの×の締めだけは
 * 例外で、窓は断面を App へ渡し、1枚に集まる (ADR-0012 Decision 1)。
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
  onClosingState,
}: ChatPaneHostProps) {
  const chat = useChatSession(pane.id, onLedgerChange, () => onExited(pane.id));

  // 引き上げる口も答える口も毎描画で作り直される値なので、そのまま effect の
  // 依存に並べると 引き上げ→App が再描画→新しい関数→引き上げ… の輪になる。
  // 関数は ref 越しに最新を読む固定の口へ包み、依存にはデータだけを置く
  // （useChatSession が呼び先を ref で持つのと同じ作法）。
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const reportRef = useRef(onClosingState);
  reportRef.current = onClosingState;
  const answerPortRef = useRef({
    answer: (send: string) => chatRef.current.answerClosing(send),
    abandon: () => chatRef.current.abandonBoundary(),
  });

  // 見出しに引く事実 (ADR-0012 Decision 1)。締めていない間は探さない — 送信の
  // たびに伸びるログを毎描画で舐める理由が無い。
  const quote = chat.closing ? firstUserSay(chat.messages) : "";

  useEffect(() => {
    if (!chat.closing) {
      reportRef.current(pane.id, null);
      return;
    }
    reportRef.current(pane.id, {
      done: chat.closingDone,
      question: chat.closingQuestion,
      notes: chat.closingNotes,
      firstUserSay: quote,
      ...answerPortRef.current,
    });
  }, [pane.id, chat.closing, chat.closingDone, chat.closingQuestion, chat.closingNotes, quote]);

  // 窓が消えたら断面も引き取る。掃除を上の effect の cleanup に置かないのは、
  // 問いが来るたび「消してから置く」の2度書きになり、1枚が毎回セクションごと
  // 描き直されるため。
  useEffect(() => () => reportRef.current(pane.id, null), [pane.id]);

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
          onNewChat={() => void chat.newChat()}
          newChatDisabled={chat.boundaryActive || chat.closing}
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
        {/* 権限の問いは窓の中に出る (本体 ADR-0053)。他の窓は動き続ける —
            これはその窓の Tomo が仕事を進めるために要るものだから。 */}
        {chat.permission !== null && (
          <PermissionDialog request={chat.permission} onAnswer={chat.answerPermission} />
        )}
      </section>
    </RunCommandProvider>
  );
}
