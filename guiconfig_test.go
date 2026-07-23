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
