import { ChooseDirectory } from "../../wailsjs/go/main/App";
import { errorMessage } from "../errorMessage";
import { addReadDir, displayDir } from "../workspacePath";

interface WorkspaceBarProps {
  // 未読み込みの間は null。ボタンは出すが押せない（バーの高さが後から
  // 生えてログの位置が飛ぶのを避ける）。
  workingDir: string | null;
  readDirs: string[];
  // 働く場所は作業ディレクトリと読み取り先が一組（本体へは全置換で宣言する
  // — 本体 ADR-0047）。片方だけ触るときも、もう片方は今の値をそのまま渡す。
  onChange: (workingDir: string, readDirs: string[]) => void;
  onError: (message: string) => void;
}

// Tomo がどこで働くかを、送る前に見せるバー (ADR-0004 Decision 4)。端末の
// `cd` が持っていた「打つ前に見えている」性質を GUI に戻す。
export function WorkspaceBar({ workingDir, readDirs, onChange, onError }: WorkspaceBarProps) {
  const ready = workingDir !== null;
  const current = workingDir ?? "";

  async function pick(title: string, startAt: string): Promise<string> {
    try {
      return await ChooseDirectory(title, startAt);
    } catch (err) {
      onError(`フォルダの選択に失敗: ${errorMessage(err)}`);
      return "";
    }
  }

  async function chooseWorkingDir() {
    const dir = await pick("Tomoが働く場所を選ぶ", current);
    if (dir === "" || dir === current) {
      return;
    }
    // 新しい作業ディレクトリと同じ場所が読み取り先に残っていても害はないが、
    // 「元から読める場所」を追加で宣言している見た目になるので畳む。
    onChange(dir, readDirs.filter((d) => d !== dir));
  }

  async function chooseReadDir() {
    const dir = await pick("読み取りを許す場所を追加する", current);
    const next = addReadDir(readDirs, current, dir);
    if (next === readDirs) {
      return;
    }
    onChange(current, next);
  }

  return (
    <div className="workspace-bar">
      <button
        className="workspace-chip workspace-chip--work"
        onClick={() => void chooseWorkingDir()}
        disabled={!ready}
        title={
          current === ""
            ? "作業ディレクトリ未設定 — GUIを起動した場所でTomoが働く。押すと選び直せる"
            : `作業ディレクトリ: ${current}`
        }
      >
        <span aria-hidden="true">📁</span>
        {current === "" ? "作業ディレクトリを選ぶ" : displayDir(current)}
      </button>

      {/* 「読み取り」は言葉で置く: 作業ディレクトリとの違いをアイコンの図案に
          委ねると、絵文字の描画差で意味が伝わらない（実機で確認） */}
      {readDirs.length > 0 && <span className="workspace-label">読み取り</span>}

      {readDirs.map((dir) => (
        <span key={dir} className="workspace-chip workspace-chip--read" title={`読み取り先: ${dir}`}>
          {displayDir(dir)}
          <button
            className="workspace-chip-remove"
            onClick={() => onChange(current, readDirs.filter((d) => d !== dir))}
            aria-label={`${dir} を読み取り先から外す`}
            title="読み取り先から外す"
          >
            ×
          </button>
        </span>
      ))}

      <button
        className="workspace-add-btn"
        onClick={() => void chooseReadDir()}
        disabled={!ready}
        title="作業ディレクトリの外で扱わせる場所を足す（Providerによらず効く）"
      >
        ＋ 読み取り先
      </button>
    </div>
  );
}
