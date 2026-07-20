package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// TOMOBIT_GUI_E2E=1 で有効になる実環境検証: GUI の chat 起動（pipe + TOMOBIT_FACE
// 沈黙 → =1 を立てる）で実物の顔窓が開き、対話の終わり（stdin EOF → プロセス終了 →
// 在席0 → 猶予）で閉じることを見る。かつて TOMOBIT_FACE=1 は pipe では本体の TTY
// ゲートに握り潰される死に配線で（本体 ADR-0032 以前）、その死活はユニットテスト
// （env 合成の確認）には映らない — だから実プロセス・実窓で見る。ターンは走らせない
// （顔窓は chat 起動時に開く）ので Provider 呼び出しはゼロ。
func TestE2E_顔窓がGUIのchat起動で開き対話の終わりで閉じる(t *testing.T) {
	if os.Getenv("TOMOBIT_GUI_E2E") == "" {
		t.Skip("TOMOBIT_GUI_E2E=1 のときだけ実環境を動かす")
	}
	if faceRunning() {
		t.Skip("顔窓が既に開いている — 本体の facelock が spawn を見送るため死活を判別できない")
	}
	db := filepath.Join(t.TempDir(), "e2e.db")
	t.Setenv("TOMOBIT_DB", db)
	// エフェメラル既定（本体 ADR-0027）を固定: ユーザー config の resident 設定に
	// 左右されず「閉じる」まで検証する。
	t.Setenv("TOMOBIT_FACE_RESIDENT", "0")
	// TOMOBIT_FACE は未設定にする（GUI が沈黙時に =1 を立てる仕様が被験体）。
	// t.Setenv は元値の復元を登録するためだけに呼び、直後に消す。
	if v, ok := os.LookupEnv("TOMOBIT_FACE"); ok {
		t.Setenv("TOMOBIT_FACE", v)
		os.Unsetenv("TOMOBIT_FACE")
	}

	app := NewApp()
	app.emit = func(string, ...interface{}) {}

	// 最初の1行を /exit にする: chat は起動し（ここで顔窓が開く）、ターンを走らせず
	// 境界だけ踏む。締めの Feedback 質問が来ても後段の shutdown（stdin EOF = 無信号）
	// が答えになる — SendLine("") で答えないのは、プロセスが先に終わっていた場合に
	// ensureProcLocked が新しい chat と顔窓をもう一組立ててしまうから。
	if err := app.SendLine("/exit"); err != nil {
		t.Fatal(err)
	}
	waitCond(t, "顔窓プロセスの出現", 20*time.Second, faceRunning)

	app.shutdown(nil)
	waitCond(t, "顔窓プロセスの消滅（在席0 → 猶予後に閉じる）", 30*time.Second,
		func() bool { return !faceRunning() })
}

// faceRunning reports whether a tomobit-face process is on the machine —
// the same machine-wide granularity as the body's facelock.
func faceRunning() bool {
	return exec.Command("pgrep", "-x", "tomobit-face").Run() == nil
}

func waitCond(t *testing.T, what string, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("%s が %s 待っても起きない", what, timeout)
}
