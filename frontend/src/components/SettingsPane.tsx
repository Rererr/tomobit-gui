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

// チャットを走らせるProvider（本体 ADR-0043 Decision 5）。未設定（キー無し）は
// auto — Go側 GUIConfig.ChatProvider の既定と揃える。
// selectの選択肢である以上、本体 resolveProvider の語彙をここでも複製せざるを
// えない（guiconfig.go の ChatProvider コメントが退けた複製と同種）。本体に
// providerが追加/変更されたら、この配列も揃えて更新すること。
const PROVIDERS = ["auto", "claude-code", "codex", "human"] as const;

function chatProvider(provider?: string): string {
  return provider || "auto";
}

export function SettingsPane() {
  const [speakingStyle, setSpeakingStyle] = useState("");
  const [savedStyle, setSavedStyle] = useState<string | null>(null);
  const [faceEnabled, setFaceEnabled] = useState<boolean | null>(null);
  const [savedFaceEnabled, setSavedFaceEnabled] = useState<boolean | null>(null);
  // 会話の全文を残す (ADR-0003 Decision 0)。既定 OFF — キー無しは false 扱い
  // （faceWindowEnabled と違い未設定でも ON にしない）。
  const [transcriptCache, setTranscriptCache] = useState<boolean | null>(null);
  const [savedTranscriptCache, setSavedTranscriptCache] = useState<boolean | null>(null);
  // チャットのProvider（本体 ADR-0043 Decision 5）。既定 auto — Tomoが経験から選ぶ。
  const [provider, setProvider] = useState<string | null>(null);
  const [savedProvider, setSavedProvider] = useState<string | null>(null);
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
      const cache = config.transcript_cache === true;
      setTranscriptCache(cache);
      setSavedTranscriptCache(cache);
      const prov = chatProvider(config.provider);
      setProvider(prov);
      setSavedProvider(prov);
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
      await SaveGUIConfig({
        speaking_style: speakingStyle,
        face_enabled: faceEnabled ?? true,
        transcript_cache: transcriptCache ?? false,
        provider: provider ?? "auto",
      });
      setSavedStyle(speakingStyle);
      setSavedFaceEnabled(faceEnabled);
      setSavedTranscriptCache(transcriptCache);
      setSavedProvider(provider);
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
    (savedFaceEnabled !== null && faceEnabled !== savedFaceEnabled) ||
    (savedTranscriptCache !== null && transcriptCache !== savedTranscriptCache) ||
    (savedProvider !== null && provider !== savedProvider);

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

      <label className="settings-field settings-provider-field">
        <span className="settings-field-label">チャットのProvider</span>
        <select
          className="settings-select"
          value={provider ?? "auto"}
          onChange={(event) => {
            setProvider(event.target.value);
            setSaveState({ kind: "idle" });
          }}
          disabled={provider === null}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-note">
        auto はTomoが経験から選ぶ（既定）。反映は次のチャット（New chatで区切った後）から
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

      <label className="settings-checkbox-field">
        <input
          type="checkbox"
          checked={transcriptCache ?? false}
          onChange={(event) => {
            setTranscriptCache(event.target.checked);
            setSaveState({ kind: "idle" });
          }}
          disabled={transcriptCache === null}
        />
        <span>会話の全文を残す</span>
      </label>
      <p className="settings-note">
        有効な間だけ ~/.tomobit/gui-scrollback/ に会話の全文を平文で保存し、過去セッションを全文で読み返せるようにする。
        有効化は次のチャット（New chatで区切った後）から、無効化は即時（現行セッションの以後の記録も止まる）。
        OFFに戻しても既に保存した分は残る。端末の忘却（forget --session）で消したセッションは、GUIも次回起動/区切りで追随して消す
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
