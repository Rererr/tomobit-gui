import { useEffect, useState } from "react";
import { GetGUIConfig, SaveGUIConfig } from "../../wailsjs/go/main/App";
import { errorMessage } from "../errorMessage";

type SaveState = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };
type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

// 未設定（キー無しJSON）は ON — GUIConfig.FaceWindowEnabled の既定と揃える
// （Go側: guiconfig.go）。
function faceWindowEnabled(faceEnabled?: boolean): boolean {
  return faceEnabled !== false;
}

export function SettingsPane() {
  const [speakingStyle, setSpeakingStyle] = useState("");
  const [savedStyle, setSavedStyle] = useState<string | null>(null);
  const [faceEnabled, setFaceEnabled] = useState<boolean | null>(null);
  const [savedFaceEnabled, setSavedFaceEnabled] = useState<boolean | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });

  async function load() {
    setLoadState({ kind: "loading" });
    try {
      const config = await GetGUIConfig();
      setSpeakingStyle(config.speaking_style);
      setSavedStyle(config.speaking_style);
      const enabled = faceWindowEnabled(config.face_enabled);
      setFaceEnabled(enabled);
      setSavedFaceEnabled(enabled);
      setLoadState({ kind: "ready" });
    } catch (err) {
      setLoadState({
        kind: "error",
        message: `読み込みに失敗: ${errorMessage(err)}`,
      });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSave() {
    try {
      // 保存操作は loadState "ready" の間しか到達しない（下の保存ボタンの描画条件）
      // ので faceEnabled は load() で既に確定済みだが、型上は null を許すため
      // 未確定既定の ON にフォールバックしておく。
      await SaveGUIConfig({ speaking_style: speakingStyle, face_enabled: faceEnabled ?? true });
      setSavedStyle(speakingStyle);
      setSavedFaceEnabled(faceEnabled);
      setSaveState({ kind: "saved" });
    } catch (err) {
      setSaveState({
        kind: "error",
        message: `保存に失敗: ${errorMessage(err)}`,
      });
    }
  }

  const dirty =
    (savedStyle !== null && speakingStyle !== savedStyle) ||
    (savedFaceEnabled !== null && faceEnabled !== savedFaceEnabled);

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
          disabled={loadState.kind !== "ready"}
        />
      </label>
      <p className="settings-note">
        システムプロンプトに追記される — 会話の台帳（記録）には載らない
      </p>

      <label className="settings-checkbox-field">
        <input
          type="checkbox"
          checked={faceEnabled ?? false}
          onChange={(event) => {
            setFaceEnabled(event.target.checked);
            setSaveState({ kind: "idle" });
          }}
          disabled={faceEnabled === null}
        />
        <span>顔窓を開く</span>
      </label>
      <p className="settings-note">次のチャット（New chatで区切った後）から反映される</p>

      {loadState.kind === "loading" && <p className="settings-status">読み込み中…</p>}
      {loadState.kind === "error" && (
        <p className="settings-status settings-status--error">
          {loadState.message}{" "}
          <button className="settings-retry-btn" onClick={() => void load()}>
            再読み込み
          </button>
        </p>
      )}

      {loadState.kind === "ready" && (
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
