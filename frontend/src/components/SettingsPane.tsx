import { useEffect, useState } from "react";
import { GetGUIConfig, SaveGUIConfig } from "../../wailsjs/go/main/App";

type SaveState = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };
type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

export function SettingsPane() {
  const [speakingStyle, setSpeakingStyle] = useState("");
  const [savedStyle, setSavedStyle] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });

  async function load() {
    setLoadState({ kind: "loading" });
    try {
      const config = await GetGUIConfig();
      setSpeakingStyle(config.speaking_style);
      setSavedStyle(config.speaking_style);
      setLoadState({ kind: "ready" });
    } catch (err) {
      setLoadState({
        kind: "error",
        message: `読み込みに失敗: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSave() {
    try {
      await SaveGUIConfig({ speaking_style: speakingStyle });
      setSavedStyle(speakingStyle);
      setSaveState({ kind: "saved" });
    } catch (err) {
      setSaveState({
        kind: "error",
        message: `保存に失敗: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const dirty = savedStyle !== null && speakingStyle !== savedStyle;

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
