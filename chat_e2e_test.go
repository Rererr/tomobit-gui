package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// TOMOBIT_GUI_E2E=1 で有効になる実環境検証: 実物の `tomobit chat --view ndjson`
// を子プロセスに立て、実Provider（claude-code、TOMOBIT_CLAUDE_ARGS で haiku 指定）
// へ1ターン流し、view イベント列が届き・境界の Feedback 質問（await:true）まで走り・
// プロセスが綺麗に終わることを見る。最初のターンは複数行ドラフトにして行継続
// （ADR-0032 Decision 2）の実環境検証を兼ねる。台帳は TOMOBIT_DB の使い捨てDBに
// 隔離する（実台帳には積まない）。
func TestE2E_実Providerへの1ターンがviewストリームで届き区切りまで通る(t *testing.T) {
	if os.Getenv("TOMOBIT_GUI_E2E") == "" {
		t.Skip("TOMOBIT_GUI_E2E=1 のときだけ実APIを呼ぶ")
	}
	db := filepath.Join(t.TempDir(), "e2e.db")
	t.Setenv("TOMOBIT_DB", db)
	// env は config claude_args を丸ごと置き換えるため、既存の
	// --exclude-dynamic-system-prompt-sections も持ち込む。
	t.Setenv("TOMOBIT_CLAUDE_ARGS", "--model haiku --exclude-dynamic-system-prompt-sections")
	// 実顔窓を開かない: env 既設定を尊重する仕様（ADR-0032 Decision 3）が前提で、
	// テストが GUI 起動の副作用（窓）を落とすには =0 の明示で足りる。
	t.Setenv("TOMOBIT_FACE", "0")

	type stamped struct {
		at time.Time
		ev map[string]any
	}
	var mu sync.Mutex
	var events []stamped
	exited := make(chan ExitInfo, 1)

	app := NewApp()
	app.emit = func(name string, data ...interface{}) {
		mu.Lock()
		defer mu.Unlock()
		switch name {
		case eventChatView:
			events = append(events, stamped{time.Now(), data[0].(map[string]any)})
		case eventChatExit:
			exited <- data[0].(ExitInfo)
		}
	}

	// match が真になる view イベントが届くまで待つ。
	waitFor := func(what string, match func(ev map[string]any) bool, timeout time.Duration) {
		t.Helper()
		deadline := time.Now().Add(timeout)
		for time.Now().Before(deadline) {
			mu.Lock()
			for _, s := range events {
				if match(s.ev) {
					mu.Unlock()
					return
				}
			}
			mu.Unlock()
			time.Sleep(200 * time.Millisecond)
		}
		t.Fatalf("%s が %s 待っても届かない", what, timeout)
	}
	containsText := func(typ, key, substr string) func(map[string]any) bool {
		return func(ev map[string]any) bool {
			if ev["type"] != typ {
				return false
			}
			v, ok := ev[key].(string)
			return ok && strings.Contains(v, substr)
		}
	}

	// 最初のターンは複数行ドラフト: 末尾 `\` 継続でエンコードされ、本体が1ターンに
	// 繋ぎ直す（ADR-0032 Decision 2）ことの実環境検証を兼ねる。
	if err := app.SendLine("1たす1の答えを\n半角数字ひとつだけで答えて"); err != nil {
		t.Fatal(err)
	}
	waitFor(`text イベントの "2"`, containsText("text", "text", "2"), 180*time.Second)

	if err := app.SendLine("/exit"); err != nil {
		t.Fatal(err)
	}
	// 区切りの尾部: Feedback 質問は await:true の note で届く。Enter（=まだ言えない）で答える。
	waitFor(`await:true の note "どうだった"`, func(ev map[string]any) bool {
		return ev["type"] == "note" && ev["await"] == true && strings.Contains(toString(ev["text"]), "どうだった")
	}, 30*time.Second)
	if err := app.SendLine(""); err != nil {
		t.Fatal(err)
	}

	select {
	case info := <-exited:
		if info.Error != "" {
			t.Fatalf("chat が異常終了: %s", info.Error)
		}
	case <-time.After(120 * time.Second):
		t.Fatal("知覚を待っても chat が終わらない")
	}

	if fi, err := os.Stat(db); err != nil || fi.Size() == 0 {
		t.Fatalf("使い捨て台帳に何も積まれていない: %v", err)
	}

	// view イベントの到着タイムラインをログに残す。
	mu.Lock()
	defer mu.Unlock()
	for _, s := range events {
		t.Logf("%s %v", s.at.Format("15:04:05.000"), s.ev)
	}
}

func toString(v any) string {
	s, _ := v.(string)
	return s
}
