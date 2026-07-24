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
