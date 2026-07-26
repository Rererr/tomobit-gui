package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// TOMOBIT_GUI_E2E=1 で有効になる実環境検証: GUI設定で顔窓を明示ONにした状態の
// chat 起動（pipe + TOMOBIT_FACE 沈黙 → =1 を立てる）で実物の顔窓が開き、対話の
// 終わり（stdin EOF → プロセス終了 → 在席0 → 猶予）で閉じることを見る。かつて
// TOMOBIT_FACE=1 は pipe では本体の TTY ゲートに握り潰される死に配線で（本体
// ADR-0032 以前）、その死活はユニットテスト（env 合成の確認）には映らない —
// だから実プロセス・実窓で見る。ターンは走らせない（顔窓は chat 起動時に開く）
// ので Provider 呼び出しはゼロ。
func TestE2E_顔窓がGUI設定ONのchat起動で開き対話の終わりで閉じる(t *testing.T) {
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
	// 顔窓は明示 ON にする: 既定は OFF になった（ADR-0001 Decision 5 追記
	// 2026-07-26）ので、無設定のままでは「開く」経路そのものを踏まない。
	on := true
	app.guiConfig = GUIConfig{FaceEnabled: &on}

	// 最初の1行を /exit にする: chat は起動し（ここで顔窓が開く）、ターンを走らせず
	// 境界だけ踏む。締めの Feedback 質問が来ても後段の shutdown（stdin EOF = 無信号）
	// が答えになる — SendLine("") で答えないのは、プロセスが先に終わっていた場合に
	// ensureProcLocked が新しい chat と顔窓をもう一組立ててしまうから。
	if err := app.SendLine(mainPane, "/exit"); err != nil {
		t.Fatal(err)
	}
	waitCond(t, "顔窓プロセスの出現", 20*time.Second, faceRunning)

	app.shutdown(nil)
	waitCond(t, "顔窓プロセスの消滅（在席0 → 猶予後に閉じる）", 30*time.Second,
		func() bool { return !faceRunning() })
}

// TOMOBIT_GUI_E2E=1 で有効になる実環境検証: 顔窓トグルが OFF の状態（キー無しの
// 既定・明示 false のどちらも同じ沈黙に落ちる）で chat を起動しても、pipe に
// TOMOBIT_FACE=1 が立たず実物の顔窓プロセスが現れないことを見る。既定が OFF に
// なった今 (ADR-0001 Decision 5 追記 2026-07-26)、これは「初めて GUI を開いた人
// の画面に二匹目が出ない」の実測でもある。composeChatEnv のユニットテスト
// （env合成の確認）は実プロセスを立てないため、本体の TTY ゲート越しでも本当に
// 沈黙が「開かない」に落ちることまでは映らない — だから実プロセス・実窓で見る。
func TestE2E_顔窓がGUI設定OFFではchat起動で開かない(t *testing.T) {
	if os.Getenv("TOMOBIT_GUI_E2E") == "" {
		t.Skip("TOMOBIT_GUI_E2E=1 のときだけ実環境を動かす")
	}
	if faceRunning() {
		t.Skip("顔窓が既に開いている — 本体の facelock が spawn を見送るため死活を判別できない")
	}
	db := filepath.Join(t.TempDir(), "e2e.db")
	t.Setenv("TOMOBIT_DB", db)
	t.Setenv("TOMOBIT_FACE_RESIDENT", "0")
	// TOMOBIT_FACE は未設定にする — 被験体は GUI 設定側の OFF であって、親環境の
	// 明示 OFF ではない（明示 OFF は既存の composeChatEnv ユニットテストが担う）。
	if v, ok := os.LookupEnv("TOMOBIT_FACE"); ok {
		t.Setenv("TOMOBIT_FACE", v)
		os.Unsetenv("TOMOBIT_FACE")
	}

	app := NewApp()
	app.emit = func(string, ...interface{}) {}
	// guiConfig はゼロ値のまま = face_enabled キー無し（既定 OFF）。実際に
	// 初回起動の人が持つ状態そのもので走らせる。
	app.guiConfig = GUIConfig{}

	// /exit だけ送ってターンは走らせない（顔窓は chat 起動時に開く／開かないが
	// 決まる）。
	if err := app.SendLine(mainPane, "/exit"); err != nil {
		t.Fatal(err)
	}
	// 顔窓が開くとすれば TestE2E_顔窓がGUIのchat起動で開き対話の終わりで閉じる
	// が 20s 以内の出現を確認している基準に倣い、同じ長さ起きないことを見届ける。
	assertNever(t, "GUI設定でOFFにしたのに顔窓プロセスが現れた", 20*time.Second, faceRunning)

	app.shutdown(nil)
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

// assertNever holds window open, failing the moment cond becomes true —
// the negative counterpart of waitCond for "this must not happen" e2e checks.
func assertNever(t *testing.T, failMsg string, window time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(window)
	for time.Now().Before(deadline) {
		if cond() {
			t.Fatal(failMsg)
		}
		time.Sleep(200 * time.Millisecond)
	}
}
