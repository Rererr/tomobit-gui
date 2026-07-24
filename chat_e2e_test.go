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
	// Provider は明示で claude-code（本体 ADR-0043 Decision 5）: このテストの意図は
	// 「本体と繋がるか」であって「誰が選ばれるか」ではない。auto のまま走らせると
	// 空台帳のくじで human を引いて無限待ちしうる。
	app.guiConfig = GUIConfig{Provider: "claude-code"}
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

// TOMOBIT_GUI_E2E=1 で有効になるスクロールバック永続 (ADR-0003) の実環境検証:
// transcript_cache を ON にした App が実 chat プロセスの view ストリームを
// <sid>.ndjson へ素通し追記し（sid 判明前の init/ready をバッファして task.started
// でまとめて書く）、権限 0600/0700 であることを見る。スクロールバックは台帳
// (TOMOBIT_DB) の隣に出るので、使い捨て DB へ向けるだけで実 ~/.tomobit を汚さず
// 隔離できる — HOME は実物のまま（Provider の認証情報が実 HOME 配下にあり、これを
// 使い捨てにすると認証が壊れ応答が来ない実測がある）。
//
// 実測メモ: view ストリームの task.started は sid だけで intent を運ばない
// （ユーザーの発話は view に乗らず、全文表示では台帳 digest の intent を n で
// 突き合わせて復元する — viewFold.ts）。ここでは Tomo 側の素通し完全性
// （task.started/turn.started/text/turn.finished の全通過）を確かめる。
// OFF 側の「1バイトも書かない」は scrollback_test.go のゲート単体テストが担う。
func TestE2E_transcript_cache_ONで実viewストリームが全文追記される(t *testing.T) {
	if os.Getenv("TOMOBIT_GUI_E2E") == "" {
		t.Skip("TOMOBIT_GUI_E2E=1 のときだけ実APIを呼ぶ")
	}
	db := filepath.Join(t.TempDir(), "e2e.db")
	t.Setenv("TOMOBIT_DB", db)
	t.Setenv("TOMOBIT_CLAUDE_ARGS", "--model haiku --exclude-dynamic-system-prompt-sections")
	t.Setenv("TOMOBIT_FACE", "0")

	exited := make(chan ExitInfo, 1)
	var mu sync.Mutex
	var sawText bool
	app := NewApp()
	on := true
	// Provider 明示は上のE2Eと同じ理由（本体 ADR-0043 Decision 5）。
	app.guiConfig = GUIConfig{TranscriptCache: &on, Provider: "claude-code"}
	app.emit = func(name string, data ...interface{}) {
		mu.Lock()
		defer mu.Unlock()
		switch name {
		case eventChatView:
			if ev, ok := data[0].(map[string]any); ok && ev["type"] == "text" {
				sawText = true
			}
		case eventChatExit:
			exited <- data[0].(ExitInfo)
		}
	}

	if err := app.SendLine("1たす1の答えを半角数字ひとつだけで答えて"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(180 * time.Second)
	for {
		mu.Lock()
		got := sawText
		mu.Unlock()
		if got {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("text イベントが届かない")
		}
		time.Sleep(200 * time.Millisecond)
	}
	if err := app.SendLine("/exit"); err != nil {
		t.Fatal(err)
	}
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

	dir := filepath.Join(filepath.Dir(db), "gui-scrollback")
	di, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("スクロールバックのディレクトリが無い: %v", err)
	}
	if di.Mode().Perm() != 0o700 {
		t.Errorf("ディレクトリ権限 = %v, want 0700", di.Mode().Perm())
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var files []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".ndjson") {
			files = append(files, e.Name())
		}
	}
	if len(files) != 1 {
		t.Fatalf("ndjson ファイル = %v, want 1件", files)
	}
	path := filepath.Join(dir, files[0])
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Errorf("ファイル権限 = %v, want 0600", fi.Mode().Perm())
	}

	events, ok, err := readScrollback(path)
	if err != nil || !ok {
		t.Fatalf("スクロールバックが読めない: ok=%v err=%v", ok, err)
	}
	want := map[string]bool{"task.started": false, "turn.started": false, "text": false, "turn.finished": false}
	var startedSID string
	for _, ev := range events {
		typ := toString(ev["type"])
		if _, ok := want[typ]; ok {
			want[typ] = true
		}
		if typ == "task.started" {
			startedSID = toString(ev["sid"])
		}
	}
	for typ, seen := range want {
		if !seen {
			t.Errorf("%s が素通しされていない: %+v", typ, events)
		}
	}
	// sid が判明する行より前 (init/ready) がバッファされてから同じファイルに
	// まとまっていること = ファイル名の sid と task.started の sid が一致する。
	if startedSID == "" || files[0] != startedSID+".ndjson" {
		t.Errorf("ファイル名 %q と task.started の sid %q が食い違う", files[0], startedSID)
	}
	t.Logf("scrollback %s: %d events", files[0], len(events))
}
