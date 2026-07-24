// GUI自身の配線 (ADR-0001 Decision 4): 好みの喋り方は ~/.tomobit/gui.json に
// 置く。会話の台帳（tomobit.db）とは別のファイルで、配線であって経験ではない
// （ADR-0021と同じ位置づけ）。
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// GUIConfig is ~/.tomobit/gui.json's whole shape.
type GUIConfig struct {
	SpeakingStyle string `json:"speaking_style"`

	// FaceEnabled は顔窓トグル (ADR-0001 Decision 5)。ポインタで「キー無し」と
	// 「明示 false」を区別する: 既存の gui.json にはまだキーが無く、それは
	// 現行挙動（ON）のまま読める必要がある。plain bool では両者が区別できず
	// 後方互換が壊れる。
	FaceEnabled *bool `json:"face_enabled,omitempty"`

	// TranscriptCache は会話全文のスクロールバック永続 (ADR-0003 Decision 0)。
	// FaceEnabled と同じ tri-state ポインタだが既定は逆で、キー無し=OFF —
	// 機微の永続は同意ゲートの向こう側なので、人が明示 true を入れるまで
	// 1バイトも書かない（既存 gui.json にキーが無いのが安全側の初期状態）。
	TranscriptCache *bool `json:"transcript_cache,omitempty"`

	// Provider はチャット子プロセスへ渡す --provider（本体 ADR-0043 Decision 5）。
	// FaceEnabled らと同じ「キー無し＝既定」の流儀だが、string は "" 自体が
	// 「未設定」を表せるためポインタは要らない。未設定＝auto — 解決は
	// ChatProvider() が行い、起動 argv には常に明示で積む（本体の既定が将来
	// 動いても GUI の挙動が無言で変わらないため）。
	Provider string `json:"provider,omitempty"`
}

// ChatProvider resolves the provider choice for the chat launch (本体
// ADR-0043 Decision 5): the saved name, or "auto" when unset. 検証はしない —
// 名前の正否は本体 resolveProvider が起動時に意味のあるエラーで答える側で、
// GUI が語彙を複製すると本体への追随漏れが黙ったバグになる。
// ただし frontend/src/components/SettingsPane.tsx の PROVIDERS だけは
// select の選択肢として複製せざるを得ない — 本体に provider が追加/変更
// されたら、そちらも揃えて更新すること。
func (c GUIConfig) ChatProvider() string {
	if c.Provider == "" {
		return "auto"
	}
	return c.Provider
}

// FaceWindowEnabled resolves the tri-state (unset/ON/explicit OFF) to the
// bool composeChatEnv needs. Unset means ON — 既存の gui.json にキーが無くて
// も顔窓が黙って閉じない後方互換。
func (c GUIConfig) FaceWindowEnabled() bool {
	return c.FaceEnabled == nil || *c.FaceEnabled
}

// TranscriptCacheEnabled resolves the tri-state (unset/ON/explicit OFF) to the
// bool the scrollback writer gates on. Unset means OFF (ADR-0003 Decision 0) —
// FaceWindowEnabled の逆の既定: 機微の永続は明示 true が来るまで始めない。
func (c GUIConfig) TranscriptCacheEnabled() bool {
	return c.TranscriptCache != nil && *c.TranscriptCache
}

func guiConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".tomobit", "gui.json"), nil
}

// loadGUIConfig reads ~/.tomobit/gui.json.
func loadGUIConfig() (GUIConfig, error) {
	p, err := guiConfigPath()
	if err != nil {
		return GUIConfig{}, err
	}
	return loadGUIConfigFile(p)
}

// loadGUIConfigFile is loadGUIConfig for an explicit path (tests). A missing
// file is not an error — it is the zero config (nothing set yet); a broken
// file is, so a typo never silently downgrades to defaults.
func loadGUIConfigFile(path string) (GUIConfig, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return GUIConfig{}, nil
	}
	if err != nil {
		return GUIConfig{}, err
	}
	var c GUIConfig
	if err := json.Unmarshal(data, &c); err != nil {
		return GUIConfig{}, fmt.Errorf("%s: %w", path, err)
	}
	return c, nil
}

// saveGUIConfig writes GUIConfig to ~/.tomobit/gui.json, creating the
// directory if needed.
func saveGUIConfig(c GUIConfig) error {
	p, err := guiConfigPath()
	if err != nil {
		return err
	}
	return saveGUIConfigFile(p, c)
}

// saveGUIConfigFile is saveGUIConfig for an explicit path (tests). 0600: the
// file ends up embedding the speaking style straight into
// --append-system-prompt, so it gets the same care as other machine-local
// wiring (internal/config.SaveFile in the body). Temp+rename like the body's
// SaveFile: loadGUIConfigFile treats a broken file as an error, so a write
// interrupted mid-way must never leave half a JSON behind.
func saveGUIConfigFile(path string, c GUIConfig) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
