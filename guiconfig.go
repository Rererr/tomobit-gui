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
	"strings"
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

	// WorkingDir はチャット子プロセスの作業ディレクトリ (ADR-0004 Decision 1)。
	// 空＝GUI の起動ディレクトリをそのまま継承する（従来挙動）。string の ""
	// が「未設定」を表せるので Provider と同じくポインタは要らない。
	WorkingDir string `json:"working_dir,omitempty"`

	// ReadDirs は作業ディレクトリの外で読ませる場所 (ADR-0004 Decision 2)。
	// claude の --add-dir へ落ちるため、Provider が claude-code のときだけ効く。
	ReadDirs []string `json:"read_dirs,omitempty"`

	// Provider はチャット子プロセスへ渡す --provider（本体 ADR-0043 Decision 5）。
	// FaceEnabled らと同じ「キー無し＝既定」の流儀だが、string は "" 自体が
	// 「未設定」を表せるためポインタは要らない。未設定＝auto — 解決は
	// ChatProvider() が行い、起動 argv には常に明示で積む（本体の既定が将来
	// 動いても GUI の挙動が無言で変わらないため）。
	Provider string `json:"provider,omitempty"`

	// RunCommand はチャット内のコマンド実行ボタン (ADR-0007 Decision 1)。
	// TranscriptCache と同じ tri-state で既定も同じ側 — キー無し＝OFF。
	// 実行経路は便利さのために既定で開けてよい種類の口ではないので、
	// 明示 true が来るまでボタンそのものを出さない（本体 ADR-0049
	// 「沈黙は同意ではない」）。
	RunCommand *bool `json:"run_command,omitempty"`

	// SidebarTomoCollapsed / SidebarUsageCollapsed はサイドバーの2つの
	// 開閉式セクション (ADR-0006) の畳み状態。「表示ノブ」は gui.json に置く
	// —— ADR-0001 Decision 4 が定めた置き場そのもの。
	//
	// キー無し＝開いている: どちらも「常に見えるように」という要求で生えた
	// セクションなので、初回は開いた姿が既定。畳んだ人の意思だけを true として
	// 書き残す（bool のゼロ値がそのまま既定になるのでポインタは要らない）。
	SidebarTomoCollapsed  bool `json:"sidebar_tomo_collapsed,omitempty"`
	SidebarUsageCollapsed bool `json:"sidebar_usage_collapsed,omitempty"`
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

// NormalizedReadDirs returns the extra readable dirs with blanks and repeats
// dropped, order preserved (ADR-0004 Decision 2). 手書きの gui.json も通るので
// 正規化は読み手側に置く: 同じ --add-dir を二度積んでも害はないが、UI の
// チップも argv も「一度言えば一度だけ」の方が読める。
func (c GUIConfig) NormalizedReadDirs() []string {
	seen := make(map[string]bool, len(c.ReadDirs))
	dirs := make([]string, 0, len(c.ReadDirs))
	for _, d := range c.ReadDirs {
		d = strings.TrimSpace(d)
		if d == "" || seen[d] {
			continue
		}
		seen[d] = true
		dirs = append(dirs, d)
	}
	return dirs
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

// RunCommandEnabled resolves the tri-state (unset/explicit ON/explicit OFF) for
// the in-chat run button (ADR-0007 Decision 1). Unset means OFF, like
// TranscriptCacheEnabled — 実行の口は明示 true が来るまで開かない。
func (c GUIConfig) RunCommandEnabled() bool {
	return c.RunCommand != nil && *c.RunCommand
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
