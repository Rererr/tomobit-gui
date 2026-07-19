package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// TOMOBIT_GUI_E2E=1 で有効になる実環境検証: 実物の `tomobit chat` を子プロセス
// に立て、実Provider（claude-code、TOMOBIT_CLAUDE_ARGS で haiku 指定）へ1ターン
// 流し、ストリームが届き・区切りが走り・プロセスが綺麗に終わることを見る。
// 台帳は TOMOBIT_DB の使い捨てDBに隔離する（実台帳には積まない）。
func TestE2E_実Providerへの1ターンがストリームで届き区切りまで通る(t *testing.T) {
	if os.Getenv("TOMOBIT_GUI_E2E") == "" {
		t.Skip("TOMOBIT_GUI_E2E=1 のときだけ実APIを呼ぶ")
	}
	db := filepath.Join(t.TempDir(), "e2e.db")
	t.Setenv("TOMOBIT_DB", db)
	// env は config claude_args を丸ごと置き換えるため、既存の
	// --exclude-dynamic-system-prompt-sections も持ち込む。
	t.Setenv("TOMOBIT_CLAUDE_ARGS", "--model haiku --exclude-dynamic-system-prompt-sections")

	type stamped struct {
		at    time.Time
		chunk OutChunk
	}
	var mu sync.Mutex
	var out []stamped
	exited := make(chan ExitInfo, 1)

	app := NewApp()
	app.emit = func(name string, data ...interface{}) {
		mu.Lock()
		defer mu.Unlock()
		switch name {
		case eventChatOut:
			out = append(out, stamped{time.Now(), data[0].(OutChunk)})
		case eventChatExit:
			exited <- data[0].(ExitInfo)
		}
	}

	stdoutText := func() string {
		mu.Lock()
		defer mu.Unlock()
		var b strings.Builder
		for _, s := range out {
			if s.chunk.Channel == "stdout" {
				b.WriteString(s.chunk.Text)
			}
		}
		return b.String()
	}
	waitFor := func(substr string, timeout time.Duration) {
		t.Helper()
		deadline := time.Now().Add(timeout)
		for time.Now().Before(deadline) {
			if strings.Contains(stdoutText(), substr) {
				return
			}
			time.Sleep(200 * time.Millisecond)
		}
		t.Fatalf("%q が %s 待っても届かない。stream:\n%s", substr, timeout, stdoutText())
	}

	if err := app.SendLine("1たす1の答えを半角数字ひとつだけで答えて"); err != nil {
		t.Fatal(err)
	}
	waitFor("2", 180*time.Second)

	if err := app.SendLine("/exit"); err != nil {
		t.Fatal(err)
	}
	// 区切りの尾部: Feedback 質問が届いたら Enter（=まだ言えない）で答える。
	waitFor("どうだった", 30*time.Second)
	if err := app.SendLine(""); err != nil {
		t.Fatal(err)
	}

	select {
	case info := <-exited:
		if info.Error != "" {
			t.Fatalf("chat が異常終了: %s", info.Error)
		}
	case <-time.After(120 * time.Second):
		t.Fatalf("知覚を待っても chat が終わらない。stream:\n%s", stdoutText())
	}

	if fi, err := os.Stat(db); err != nil || fi.Size() == 0 {
		t.Fatalf("使い捨て台帳に何も積まれていない: %v", err)
	}

	// ストリーミングの証拠をログに残す（チャンクの到着タイムライン）。
	mu.Lock()
	defer mu.Unlock()
	for _, s := range out {
		t.Logf("%s [%s] %q", s.at.Format("15:04:05.000"), s.chunk.Channel, s.chunk.Text)
	}
}
