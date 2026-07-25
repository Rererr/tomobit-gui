import { useEffect, useRef, useState } from "react";
import type { main } from "../../wailsjs/go/models";
import { errorMessage } from "../errorMessage";

type SaveState = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

interface SettingsPaneProps {
  // gui.json の唯一のコピー（App が持つ）。未読み込みは null。作業バーも同じ
  // コピーへ書くため、このペインは自分で読み書きしない (ADR-0004 Consequences)。
  config: main.GUIConfig | null;
  loadError: string | null;
  onReload: () => void;
  onSave: (patch: Partial<main.GUIConfig>) => Promise<void>;
}

// 未設定（キー無しJSON）は ON — GUIConfig.FaceWindowEnabled の既定と揃える
// （Go側: guiconfig.go）。
function faceWindowEnabled(faceEnabled?: boolean): boolean {
  return faceEnabled !== false;
}

// チャットを走らせるProvider（本体 ADR-0043 Decision 5）。未設定（キー無し）は
// auto — Go側 GUIConfig.ChatProvider の既定と揃える。
// selectの選択肢である以上、本体 resolveProvider の語彙をここでも複製せざるを
// えない（guiconfig.go の ChatProvider コメントが退けた複製と同種）。本体に
// providerが追加/変更されたら、この配列も揃えて更新すること。
const PROVIDERS = ["auto", "claude-code", "codex", "human"] as const;

function chatProvider(provider?: string): string {
  return provider || "auto";
}

export function SettingsPane({ config, loadError, onReload, onSave }: SettingsPaneProps) {
  const [speakingStyle, setSpeakingStyle] = useState("");
  const [faceEnabled, setFaceEnabled] = useState(true);
  // 会話の全文を残す (ADR-0003 Decision 0)。既定 OFF — キー無しは false 扱い
  // （faceWindowEnabled と違い未設定でも ON にしない）。
  const [transcriptCache, setTranscriptCache] = useState(false);
  // チャットからのコマンド実行 (ADR-0007 Decision 1)。既定 OFF —
  // transcript_cache と同じで、キー無しは false 扱い。
  const [runCommand, setRunCommand] = useState(false);
  // チャットのProvider（本体 ADR-0043 Decision 5）。既定 auto — Tomoが経験から選ぶ。
  const [provider, setProvider] = useState("auto");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  // 編集欄をディスクの値で埋めるのは初回だけ: 作業バーが gui.json を書いて
  // config が差し替わっても、編集途中の喋り方を消さない（ペイン切替で下書きを
  // 失わない既存の姿勢と同じ）。
  const initialized = useRef(false);

  useEffect(() => {
    if (config === null || initialized.current) {
      return;
    }
    initialized.current = true;
    setSpeakingStyle(config.speaking_style);
    setFaceEnabled(faceWindowEnabled(config.face_enabled));
    setTranscriptCache(config.transcript_cache === true);
    setRunCommand(config.run_command === true);
    setProvider(chatProvider(config.provider));
  }, [config]);

  async function handleSave() {
    try {
      await onSave({
        speaking_style: speakingStyle,
        face_enabled: faceEnabled,
        transcript_cache: transcriptCache,
        run_command: runCommand,
        provider,
      });
      setSaveState({ kind: "saved" });
    } catch (err) {
      setSaveState({
        kind: "error",
        message: `保存に失敗: ${errorMessage(err)}`,
      });
    }
  }

  const ready = config !== null;
  const dirty =
    config !== null &&
    (speakingStyle !== config.speaking_style ||
      faceEnabled !== faceWindowEnabled(config.face_enabled) ||
      transcriptCache !== (config.transcript_cache === true) ||
      runCommand !== (config.run_command === true) ||
      provider !== chatProvider(config.provider));

  return (
    <div className="settings-pane">
      <h2>設定</h2>

      <label className="settings-field">
        <span className="settings-field-label">好みの喋り方</span>
        <textarea
          className="settings-textarea"
          value={speakingStyle}
          onChange={(event) => {
            setSpeakingStyle(event.target.value);
            setSaveState({ kind: "idle" });
          }}
          placeholder="例: 関西弁で、絵文字は使わずに"
          rows={4}
          disabled={!ready}
        />
      </label>
      <p className="settings-note">
        システムプロンプトに追記される — 会話の台帳（記録）には載らない
      </p>

      <label className="settings-field settings-provider-field">
        <span className="settings-field-label">チャットのProvider</span>
        <select
          className="settings-select"
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value);
            setSaveState({ kind: "idle" });
          }}
          disabled={!ready}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-note">
        auto はTomoが経験から選ぶ（既定）。反映は次のチャット（New chatで区切った後）から。
        チャット下部の作業バーで足した読み取り先が効くのは claude-code のときだけ
      </p>

      <label className="settings-checkbox-field">
        <input
          type="checkbox"
          checked={faceEnabled}
          onChange={(event) => {
            setFaceEnabled(event.target.checked);
            setSaveState({ kind: "idle" });
          }}
          disabled={!ready}
        />
        <span>顔窓を開く</span>
      </label>
      <p className="settings-note">次のチャット（New chatで区切った後）から反映される</p>

      <label className="settings-checkbox-field">
        <input
          type="checkbox"
          checked={transcriptCache}
          onChange={(event) => {
            setTranscriptCache(event.target.checked);
            setSaveState({ kind: "idle" });
          }}
          disabled={!ready}
        />
        <span>会話の全文を残す</span>
      </label>
      <p className="settings-note">
        有効な間だけ ~/.tomobit/gui-scrollback/ に会話の全文を平文で保存し、過去セッションを全文で読み返せるようにする。
        有効化は次のチャット（New chatで区切った後）から、無効化は即時（現行セッションの以後の記録も止まる）。
        OFFに戻しても既に保存した分は残る。端末の忘却（forget --session）で消したセッションは、GUIも次回起動/区切りで追随して消す
      </p>

      <label className="settings-checkbox-field">
        <input
          type="checkbox"
          checked={runCommand}
          onChange={(event) => {
            setRunCommand(event.target.checked);
            setSaveState({ kind: "idle" });
          }}
          disabled={!ready}
        />
        <span>チャットからコマンドを実行する</span>
      </label>
      <p className="settings-note">
        Tomoの答えの中の sh / bash / zsh のコードブロックに実行ボタンが出る。押すと確認の帯が開き、
        走るコマンドの全文と場所（作業ディレクトリ）を見せたうえで、もう一度押して初めて走る。
        <strong>これはモデルが書いた文字列を実行する経路です</strong> — 確認の帯は、読まなければ何も守りません。
        結果は会話にも台帳にも残らず、画面を離れると消える。反映は即時
      </p>

      {!ready && loadError === null && <p className="settings-status">読み込み中…</p>}
      {loadError !== null && (
        <p className="settings-status settings-status--error">
          {loadError}{" "}
          <button className="settings-retry-btn" onClick={onReload}>
            再読み込み
          </button>
        </p>
      )}

      {ready && (
        <div className="settings-actions">
          <button className="settings-save-btn" onClick={() => void handleSave()} disabled={!dirty}>
            保存
          </button>
          {saveState.kind === "saved" && (
            <span className="settings-status settings-status--saved">
              保存した — 反映は次のチャット（New chatで区切った後）から
            </span>
          )}
          {saveState.kind === "error" && (
            <span className="settings-status settings-status--error">{saveState.message}</span>
          )}
        </div>
      )}
    </div>
  );
}
