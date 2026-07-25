package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadGUIConfigFile_ファイル無しはゼロ値でエラーなし(t *testing.T) {
	c, err := loadGUIConfigFile(filepath.Join(t.TempDir(), "gui.json"))
	if err != nil {
		t.Fatalf("missing file must not error: %v", err)
	}
	if c.SpeakingStyle != "" {
		t.Errorf("missing file must mean zero config: %+v", c)
	}
}

func TestLoadGUIConfigFile_壊れたJSONは意味のあるエラー(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gui.json")
	if err := os.WriteFile(p, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := loadGUIConfigFile(p)
	if err == nil {
		t.Fatal("broken JSON must error, never silently downgrade to defaults")
	}
	if !strings.Contains(err.Error(), p) {
		t.Errorf("error should name the path: %v", err)
	}
}

func TestGUIConfig_RoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "nested", "gui.json")
	faceOff := false
	want := GUIConfig{SpeakingStyle: "関西弁で、絵文字は使わずに", FaceEnabled: &faceOff}
	if err := saveGUIConfigFile(p, want); err != nil {
		t.Fatal(err)
	}
	got, err := loadGUIConfigFile(p)
	if err != nil {
		t.Fatal(err)
	}
	// *bool はポインタ比較になるので値ベースの FaceWindowEnabled 経由で比べる
	// （フィールドを直接 != すると往復のたびに別アドレスになり必ず不一致になる）。
	if got.SpeakingStyle != want.SpeakingStyle || got.FaceWindowEnabled() != want.FaceWindowEnabled() {
		t.Errorf("round trip = %+v, want %+v", got, want)
	}
	if fi, err := os.Stat(p); err != nil {
		t.Fatal(err)
	} else if fi.Mode().Perm() != 0o600 {
		t.Errorf("file mode = %v, want 0600", fi.Mode().Perm())
	}
}

func TestGUIConfig_FaceEnabled_キー無しJSONは後方互換でON(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gui.json")
	if err := os.WriteFile(p, []byte(`{"speaking_style":"a"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := loadGUIConfigFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !c.FaceWindowEnabled() {
		t.Errorf("face_enabled キー無しは ON であるべき: %+v", c)
	}
}

func TestGUIConfig_FaceEnabled_明示falseはOFF(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gui.json")
	if err := os.WriteFile(p, []byte(`{"face_enabled":false}`), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := loadGUIConfigFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if c.FaceWindowEnabled() {
		t.Errorf("明示 false は OFF であるべき: %+v", c)
	}
}

func TestGUIConfig_FaceEnabled_明示trueはON(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gui.json")
	if err := os.WriteFile(p, []byte(`{"face_enabled":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := loadGUIConfigFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !c.FaceWindowEnabled() {
		t.Errorf("明示 true は ON であるべき: %+v", c)
	}
}

// 本体 ADR-0043 Decision 5: 未設定（キー無し・空文字）は auto。既存の
// gui.json にキーが無くても、チャットは明示 --provider auto で立つ。
func TestGUIConfig_ChatProvider_未設定はauto(t *testing.T) {
	if got := (GUIConfig{}).ChatProvider(); got != "auto" {
		t.Errorf("unset provider = %q, want auto", got)
	}
	p := filepath.Join(t.TempDir(), "gui.json")
	if err := os.WriteFile(p, []byte(`{"speaking_style":"a"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := loadGUIConfigFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if got := c.ChatProvider(); got != "auto" {
		t.Errorf("キー無しJSON の provider = %q, want auto", got)
	}
}

func TestGUIConfig_ChatProvider_明示の選択はそのまま通る(t *testing.T) {
	c := GUIConfig{Provider: "claude-code"}
	if got := c.ChatProvider(); got != "claude-code" {
		t.Errorf("provider = %q, want claude-code", got)
	}
}

// ADR-0004: 作業ディレクトリと読み取り先も gui.json に往復する。キー無しの
// 既存 gui.json は「未設定＝継承」「読み取り先なし」として読める。
func TestGUIConfig_Workspace_RoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gui.json")
	want := GUIConfig{WorkingDir: "/Users/example/personal-dev/tomobit", ReadDirs: []string{"/Users/example/notes", "/tmp/shared"}}
	if err := saveGUIConfigFile(p, want); err != nil {
		t.Fatal(err)
	}
	got, err := loadGUIConfigFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if got.WorkingDir != want.WorkingDir {
		t.Errorf("round trip working_dir = %q, want %q", got.WorkingDir, want.WorkingDir)
	}
	if strings.Join(got.NormalizedReadDirs(), "|") != strings.Join(want.ReadDirs, "|") {
		t.Errorf("round trip read_dirs = %v, want %v", got.ReadDirs, want.ReadDirs)
	}
}

func TestGUIConfig_Workspace_キー無しJSONは未設定として読める(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gui.json")
	if err := os.WriteFile(p, []byte(`{"speaking_style":"a"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := loadGUIConfigFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if c.WorkingDir != "" {
		t.Errorf("キー無しの working_dir = %q, want 空（継承）", c.WorkingDir)
	}
	if len(c.NormalizedReadDirs()) != 0 {
		t.Errorf("キー無しの read_dirs = %v, want 空", c.NormalizedReadDirs())
	}
}

func TestGUIConfig_NormalizedReadDirs_空と重複を落とし順序は保つ(t *testing.T) {
	c := GUIConfig{ReadDirs: []string{"/b", "", "  ", "/a", "/b", " /a "}}
	got := c.NormalizedReadDirs()
	want := []string{"/b", "/a"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("NormalizedReadDirs = %v, want %v", got, want)
	}
}

func TestGUIConfig_Provider_RoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gui.json")
	if err := saveGUIConfigFile(p, GUIConfig{Provider: "codex"}); err != nil {
		t.Fatal(err)
	}
	got, err := loadGUIConfigFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if got.Provider != "codex" {
		t.Errorf("round trip provider = %q, want codex", got.Provider)
	}
}

// ADR-0006: サイドバーの2セクションは「常に見えるように」という要求で生えた
// ので、既定は開いた姿。畳んだ人の意思だけを true として書き残す。
func TestGUIConfig_サイドバーの畳み状態は既定で開いている(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gui.json")
	if err := os.WriteFile(path, []byte(`{"speaking_style":"x"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := loadGUIConfigFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.SidebarTomoCollapsed || c.SidebarUsageCollapsed {
		t.Error("キー無しの gui.json が畳まれた状態で読まれる — 既定は開いている")
	}

	c.SidebarUsageCollapsed = true
	if err := saveGUIConfigFile(path, c); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "sidebar_usage_collapsed") {
		t.Error("畳んだ意思が保存されていない")
	}
	if strings.Contains(string(data), "sidebar_tomo_collapsed") {
		t.Error("開いたままの側までキーが書かれている — 既定は書かずに省く")
	}
}

// ADR-0007 Decision 1: 実行の口はキー無し＝OFF。face_enabled と逆の既定で、
// transcript_cache と同じ側 —— 明示 true が来るまでボタンそのものを出さない。
func TestGUIConfig_RunCommand_キー無しJSONはOFF(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gui.json")
	if err := os.WriteFile(p, []byte(`{"speaking_style":"a"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := loadGUIConfigFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if c.RunCommandEnabled() {
		t.Errorf("run_command キー無しは OFF であるべき: %+v", c)
	}
}

func TestGUIConfig_RunCommand_明示trueだけがON(t *testing.T) {
	for _, tc := range []struct {
		json string
		want bool
	}{
		{`{"run_command":true}`, true},
		{`{"run_command":false}`, false},
	} {
		p := filepath.Join(t.TempDir(), "gui.json")
		if err := os.WriteFile(p, []byte(tc.json), 0o600); err != nil {
			t.Fatal(err)
		}
		c, err := loadGUIConfigFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if got := c.RunCommandEnabled(); got != tc.want {
			t.Errorf("%s → RunCommandEnabled() = %v, want %v", tc.json, got, tc.want)
		}
	}
}

// OFF のまま保存したときキーを書き残さない（omitempty のポインタ）。既定 OFF の
// 設定に false を書き込むと、「一度は触った」という別の意味が JSON に残る。
func TestGUIConfig_RunCommand_未設定は保存してもキーを残さない(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gui.json")
	if err := saveGUIConfigFile(p, GUIConfig{SpeakingStyle: "a"}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "run_command") {
		t.Errorf("未設定なのに run_command が書かれている: %s", data)
	}
}
