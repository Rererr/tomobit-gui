// 姿の取得 (ADR-0001 Decision 5 追記 / 本体 ADR-0048): `tomobit-face --view json`
// をサブプロセス実行し、スプライト資産をそのまま SpriteSheet へデコードする。
// GUI は格子を1バイトも持たない — 姿の正本は顔窓のままで、こちらは描くだけ。
// stage.go（ステータスの機械可読view）と同じ型の配線で、違いは相手のバイナリ
// だけ: 状態は台帳を書く者に、姿は姿を描く者に訊く。
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// SpriteSheet is 顔窓の資産一式（本体 facewin.Sheet と同じ形）。集計も導出も
// しない — デコードして React へ渡すだけ。旧顔窓（--view を知らない版）では
// 取得自体が失敗し、サイドバーの Tomo セクションごと出ない（劣化は沈黙）。
type SpriteSheet struct {
	Type string `json:"type"`
	// Size は正方キャンバスの一辺（論理ピクセル）。
	Size    int               `json:"size"`
	Breed   string            `json:"breed"`
	Palette map[string]string `json:"palette"`
	Stages  []SpriteStage     `json:"stages"`
	// Overlays は気分記号（本体 face.Mood の marker と対応）。
	Overlays []SpriteOverlay `json:"overlays"`
	Anim     SpriteAnim      `json:"anim"`
}

// SpriteStage は1ステージ分の2フレーム。Frames[0]=A(基本) / Frames[1]=B(瞬き)
// の順は本体の契約（本体 ADR-0048 Decision 1）。
type SpriteStage struct {
	Stage  int        `json:"stage"`
	Name   string     `json:"name"`
	Frames [][]string `json:"frames"`
	// OverlayOrigin は marker ごとの左上（論理ピクセル、[x, y]）。y は頭の上を
	// 指して負になりうる。本体が計算して配る値で、GUI 側では再計算しない。
	OverlayOrigin map[string][2]int `json:"overlay_origin"`
}

type SpriteOverlay struct {
	Marker string   `json:"marker"`
	Rows   []string `json:"rows"`
}

// SpriteAnim は待機アニメのノブ。顔窓と同じ数字で動かすためのもので、
// GUI 側に既定値は持たない（持てば顔窓とずれる）。
type SpriteAnim struct {
	BlinkMinMs    int `json:"blink_min_ms"`
	BlinkJitterMs int `json:"blink_jitter_ms"`
	BlinkHoldMs   int `json:"blink_hold_ms"`
	BobPeriodMs   int `json:"bob_period_ms"`
	BobPx         int `json:"bob_px"`
}

// findTomobitFace mirrors findTomobit's search, plus the body's own rule
// (cmd/tomobit findFaceBinary): `go install` puts tomobit and tomobit-face in
// the same bin dir, so the sibling of the tomobit we already resolved is the
// best first guess — it is the pair this GUI is actually talking to.
func findTomobitFace(lookPath func(string) (string, error), userHome func() (string, error)) (string, error) {
	if p, err := lookPath("tomobit"); err == nil {
		cand := filepath.Join(filepath.Dir(p), "tomobit-face")
		if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
			return cand, nil
		}
	}
	if p, err := lookPath("tomobit-face"); err == nil {
		return p, nil
	}
	if home, err := userHome(); err == nil {
		cand := filepath.Join(home, "go", "bin", "tomobit-face")
		if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
			return cand, nil
		}
	}
	return "", fmt.Errorf("tomobit-face が見つからない — 本体を `go install ./cmd/tomobit-face` して PATH か ~/go/bin に置くこと")
}

// runTomobitFace runs the face binary and returns both streams. A package var
// for the same reason runTomobit is one: a test swaps in a capture without a
// real binary.
var runTomobitFace = runTomobitFaceSubprocess

func runTomobitFaceSubprocess(args ...string) (stdout, stderr string, err error) {
	bin, err := findTomobitFace(exec.LookPath, os.UserHomeDir)
	if err != nil {
		return "", "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), tomobitCmdTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	var outBuf, errBuf strings.Builder
	cmd.Stdout, cmd.Stderr = &outBuf, &errBuf
	err = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		err = fmt.Errorf("tomobit-face --view json が %s 以内に終わらない", tomobitCmdTimeout)
	}
	return outBuf.String(), errBuf.String(), err
}

// GetSpriteSheet asks the face window what Tomo looks like (本体 ADR-0048)。
// 資産は動かないので画面は起動時に一度だけ呼ぶ — 動く側（ステージ・気分）は
// GetTomoStatus が境界ごとに配る。
func (a *App) GetSpriteSheet() (SpriteSheet, error) {
	stdout, stderr, err := runTomobitFace("--view", "json")
	if err != nil {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = err.Error()
		}
		return SpriteSheet{}, fmt.Errorf("tomobit-face --view json の実行に失敗: %s", msg)
	}
	var sheet SpriteSheet
	if err := json.Unmarshal([]byte(stdout), &sheet); err != nil {
		return SpriteSheet{}, fmt.Errorf("tomobit-face --view json の出力を解釈できない: %w", err)
	}
	return sheet, nil
}
