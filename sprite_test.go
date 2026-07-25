package main

// 本体 ADR-0048 の読み手側。GUI は姿を再導出しないので、ここで固定するのは
// 「デコードして素通しすること」と「取れない時に黙って壊れないこと」だけ。

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGetSpriteSheet_本体のviewをそのままデコードする(t *testing.T) {
	orig := runTomobitFace
	t.Cleanup(func() { runTomobitFace = orig })

	var gotArgs []string
	runTomobitFace = func(args ...string) (string, string, error) {
		gotArgs = args
		return `{"type":"sprite","size":32,"breed":"shiba",
			"palette":{"k":"#2E2E2E"},
			"stages":[{"stage":0,"name":"毛玉","frames":[["kk"],["k."]],"overlay_origin":{"z":[19,-1]}}],
			"overlays":[{"marker":"z","rows":["mm"]}],
			"anim":{"blink_min_ms":3000,"blink_jitter_ms":1000,"blink_hold_ms":180,"bob_period_ms":3200,"bob_px":1}}`, "", nil
	}

	sheet, err := (&App{}).GetSpriteSheet()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(gotArgs, " ") != "--view json" {
		t.Errorf("argv = %v, want [--view json]", gotArgs)
	}
	if sheet.Size != 32 || sheet.Breed != "shiba" {
		t.Errorf("size/breed = %d/%q", sheet.Size, sheet.Breed)
	}
	if len(sheet.Stages) != 1 || len(sheet.Stages[0].Frames) != 2 {
		t.Fatalf("stages = %+v", sheet.Stages)
	}
	if got := sheet.Stages[0].OverlayOrigin["z"]; got != [2]int{19, -1} {
		t.Errorf("overlay_origin[z] = %v, want [19 -1] — 本体の座をそのまま持つ", got)
	}
	if sheet.Anim.BobPx != 1 || sheet.Anim.BobPeriodMs != 3200 {
		t.Errorf("anim = %+v — アニメのノブが落ちている", sheet.Anim)
	}
}

// 旧顔窓は `--view` を知らずフラグのパースで落ちる。理由は stderr に出るので、
// それを添えて返す（画面はTomoセクションを出さずに続く）。
func TestGetSpriteSheet_失敗はstderrの理由を添えて返す(t *testing.T) {
	orig := runTomobitFace
	t.Cleanup(func() { runTomobitFace = orig })
	runTomobitFace = func(...string) (string, string, error) {
		return "", "flag provided but not defined: -view\n", os.ErrInvalid
	}

	_, err := (&App{}).GetSpriteSheet()
	if err == nil || !strings.Contains(err.Error(), "not defined: -view") {
		t.Fatalf("err = %v, want 本体の言い分をそのまま含むエラー", err)
	}
}

func TestFindTomobitFace_tomobitの隣を先に見てPATHとgoのbinへ落ちる(t *testing.T) {
	pair := t.TempDir()
	writeExec(t, filepath.Join(pair, "tomobit"))
	writeExec(t, filepath.Join(pair, "tomobit-face"))

	// tomobit の隣に居れば、それが今この GUI が喋っている相手の対。
	got, err := findTomobitFace(
		func(name string) (string, error) {
			if name == "tomobit" {
				return filepath.Join(pair, "tomobit"), nil
			}
			return "", os.ErrNotExist
		},
		func() (string, error) { return t.TempDir(), nil })
	if err != nil || got != filepath.Join(pair, "tomobit-face") {
		t.Fatalf("隣を見ていない: got %q, err %v", got, err)
	}

	// 隣に居なければ ~/go/bin（Finder起動でPATHが欠ける経路の受け皿）。
	home := t.TempDir()
	bin := filepath.Join(home, "go", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	writeExec(t, filepath.Join(bin, "tomobit-face"))
	got, err = findTomobitFace(
		func(string) (string, error) { return "", os.ErrNotExist },
		func() (string, error) { return home, nil })
	if err != nil || got != filepath.Join(bin, "tomobit-face") {
		t.Fatalf("~/go/bin へ落ちていない: got %q, err %v", got, err)
	}

	// どこにも居なければ、何をすればいいかを言うエラー。
	_, err = findTomobitFace(
		func(string) (string, error) { return "", os.ErrNotExist },
		func() (string, error) { return t.TempDir(), nil })
	if err == nil || !strings.Contains(err.Error(), "go install") {
		t.Fatalf("err = %v, want 直し方を名指すエラー", err)
	}
}

func writeExec(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
}
