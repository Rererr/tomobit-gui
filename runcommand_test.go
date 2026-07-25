package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// enabledApp は run_command を明示 ON にした App。ゲート以外の挙動を試すとき、
// 毎回この2行を書かないため。
func enabledApp() *App {
	on := true
	return &App{guiConfig: GUIConfig{RunCommand: &on}}
}

func TestRunCommandRefusedWhenNotEnabled(t *testing.T) {
	// キー無し（既定）: ボタンが出ていないはずの状態で呼ばれても走らせない。
	a := &App{}
	if _, err := a.RunCommand("echo hello"); err == nil {
		t.Fatal("既定 OFF のまま走ってしまった (ADR-0007 Decision 1)")
	}

	// 明示 false も同じ。
	off := false
	a = &App{guiConfig: GUIConfig{RunCommand: &off}}
	if _, err := a.RunCommand("echo hello"); err == nil {
		t.Fatal("明示 false のまま走ってしまった")
	}
}

func TestRunCommandRefusesEmpty(t *testing.T) {
	if _, err := enabledApp().RunCommand("   \n\t "); err == nil {
		t.Fatal("空白だけのコマンドを走らせてしまった")
	}
}

func TestRunCommandReturnsOutputAndExitCode(t *testing.T) {
	run, err := enabledApp().RunCommand("echo out; echo err 1>&2; exit 3")
	if err != nil {
		t.Fatalf("走らせられなかった: %v", err)
	}
	if got := strings.TrimSpace(run.Stdout); got != "out" {
		t.Errorf("stdout = %q, want %q", got, "out")
	}
	if got := strings.TrimSpace(run.Stderr); got != "err" {
		t.Errorf("stderr = %q, want %q", got, "err")
	}
	// 終了コード 1 以上は「こちらの失敗」ではなく結果。error にせず返す。
	if run.ExitCode != 3 {
		t.Errorf("ExitCode = %d, want 3", run.ExitCode)
	}
	if run.TimedOut {
		t.Error("時間切れでないのに TimedOut が立っている")
	}
	if run.Command != "echo out; echo err 1>&2; exit 3" {
		t.Errorf("走らせたコマンドをそのまま返していない: %q", run.Command)
	}
}

func TestRunCommandGoesThroughShell(t *testing.T) {
	// ADR-0007 Decision 4: パイプを通す。ここが argv 分割に戻ると落ちる。
	run, err := enabledApp().RunCommand("printf 'b\\na\\nc\\n' | sort | head -1")
	if err != nil {
		t.Fatalf("走らせられなかった: %v", err)
	}
	if got := strings.TrimSpace(run.Stdout); got != "a" {
		t.Errorf("stdout = %q, want %q（シェルを介していない）", got, "a")
	}
}

func TestRunCommandRunsInWorkingDir(t *testing.T) {
	// ADR-0004 Decision 1 の作業ディレクトリで走る。Darwin の /var は /private/var
	// への symlink なので、pwd の文字列比較ではなく実体で突き合わせる。
	dir := t.TempDir()
	on := true
	a := &App{guiConfig: GUIConfig{RunCommand: &on, WorkingDir: dir}}
	if err := os.WriteFile(filepath.Join(dir, "しるし"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	run, err := a.RunCommand("ls")
	if err != nil {
		t.Fatalf("走らせられなかった: %v", err)
	}
	if !strings.Contains(run.Stdout, "しるし") {
		t.Errorf("作業ディレクトリで走っていない: stdout = %q", run.Stdout)
	}
	if run.WorkingDir != dir {
		t.Errorf("WorkingDir = %q, want %q", run.WorkingDir, dir)
	}
}

func TestRunCommandClosesStdin(t *testing.T) {
	// 標準入力は即 EOF (ADR-0007 Decision 4)。開けたままだと、この cat は
	// タイムアウトまで戻らない — つまりこのテストが 2 分かかる形で落ちる。
	run, err := enabledApp().RunCommand("cat")
	if err != nil {
		t.Fatalf("走らせられなかった: %v", err)
	}
	if run.TimedOut {
		t.Fatal("標準入力が開いたままで、入力待ちのコマンドが居座った")
	}
	if run.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want 0", run.ExitCode)
	}
}

func TestRunCommandRejectsSecondWhileRunning(t *testing.T) {
	// 同時に走るのは1本だけ (ADR-0007 Decision 4)。錠を外から掴んで、
	// 走行中に来た2本目が待たずに断られることを見る。
	if !tryLockRunning() {
		t.Fatal("錠が最初から取られている")
	}
	defer runningCommand.Unlock()

	if _, err := enabledApp().RunCommand("echo hello"); err == nil {
		t.Fatal("走行中なのに2本目が通ってしまった")
	}
}

func TestTruncateOutputKeepsTailAndSaysSo(t *testing.T) {
	s, cut := truncateOutput("abcdef", 10)
	if cut || s != "abcdef" {
		t.Errorf("上限以下を切ってしまった: %q, cut=%v", s, cut)
	}

	// 残すのは末尾 — 結果とエラーは最後の行に出るため。
	s, cut = truncateOutput("abcdefghij", 4)
	if !cut {
		t.Error("切ったのに cut が立っていない（黙って切り詰めない）")
	}
	if s != "ghij" {
		t.Errorf("末尾を残していない: %q", s)
	}
}

func TestTruncateOutputDoesNotSplitUTF8(t *testing.T) {
	// 「あいう」は 9 バイト。8 バイトで切ると 1 文字目の途中から始まるので、
	// 有効な先頭バイトまで進めて壊れた文字を残さない。
	s, cut := truncateOutput("あいう", 8)
	if !cut {
		t.Fatal("切っていない")
	}
	if s != "いう" {
		t.Errorf("UTF-8 の途中で割れている: %q", s)
	}
}

func TestExitCodeOfNamesUnknownEndingsMinusOne(t *testing.T) {
	// 時間切れは終了コードを名乗れない。0 を返して「正常終了」に見せない。
	if got := exitCodeOf(nil, true); got != -1 {
		t.Errorf("時間切れの ExitCode = %d, want -1", got)
	}
	if got := exitCodeOf(nil, false); got != 0 {
		t.Errorf("正常終了の ExitCode = %d, want 0", got)
	}
}
