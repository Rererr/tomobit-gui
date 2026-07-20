package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// TOMOBIT_GUI_E2E=1 で有効になる実環境検証: 実物の `tomobit chat`（実Provider・
// 実知覚）で使い捨て台帳に経験を積み、忘却の器官の境界を跨いで整合を見る —
// amend は世代交代して現行が human になるか、forget は物理削除・user.forgot
// 記帳・rebuild 後の射影（ledger）整合まで届くか。
func TestE2E_メモリの訂正と忘却がrebuild整合まで通る(t *testing.T) {
	if os.Getenv("TOMOBIT_GUI_E2E") == "" {
		t.Skip("TOMOBIT_GUI_E2E=1 のときだけ実APIを呼ぶ")
	}
	db := filepath.Join(t.TempDir(), "e2e.db")
	t.Setenv("TOMOBIT_DB", db)
	// env は config claude_args を丸ごと置き換えるため、既存の
	// --exclude-dynamic-system-prompt-sections も持ち込む。
	t.Setenv("TOMOBIT_CLAUDE_ARGS", "--model haiku --exclude-dynamic-system-prompt-sections")
	// 実顔窓を開かない: env 既設定を尊重する仕様（ADR-0032 Decision 3）が前提。
	t.Setenv("TOMOBIT_FACE", "0")

	app := seedOneRealSession(t)

	// --- 経験が積まれた ---
	view, err := app.GetMemoryView()
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Experiences) == 0 {
		t.Fatal("知覚後の台帳に経験が無い")
	}
	target := view.Experiences[0]
	t.Logf("対象: id=%s kind=%s session=%s", target.ID, target.Kind, target.SessionID)

	// --- amend: 人間の再知覚が追記され、現行世代が human になる ---
	res, err := app.AmendExperience(AmendRequest{ID: target.ID, SetOutcome: true, Outcome: `{"verdict":"up"}`})
	if err != nil {
		t.Fatalf("amend が失敗: %v", err)
	}
	if !strings.HasPrefix(res.Summary, "amended: "+target.ID) {
		t.Fatalf("amend のサマリ契約が違う: %q", res.Summary)
	}
	view2, err := app.GetMemoryView()
	if err != nil {
		t.Fatal(err)
	}
	amended := findBySessionKind(view2.Experiences, target.SessionID, target.Kind)
	if amended == nil {
		t.Fatal("amend 後に (session, kind) の現行行が消えた")
	}
	if amended.ID == target.ID {
		t.Fatalf("amend が世代交代していない（同じ id のまま）: %s", amended.ID)
	}
	if !strings.Contains(amended.Outcome, `"verdict":"up"`) {
		t.Fatalf("訂正した outcome が現行世代に載っていない: %s", amended.Outcome)
	}
	if got := queryOne(t, db, `SELECT extractor_model FROM experiences_current WHERE id = ?`, amended.ID); got != "human" {
		t.Fatalf("現行世代の extractor_model が human でない: %q", got)
	}

	// --- forget: 物理削除・user.forgot 記帳・rebuild 後の射影整合 ---
	res2, err := app.ForgetExperiences([]string{amended.ID})
	if err != nil {
		t.Fatalf("forget が失敗: %v", err)
	}
	if !strings.HasPrefix(res2.Summary, "forgot: 1 experiences") {
		t.Fatalf("forget のサマリ契約が違う: %q", res2.Summary)
	}
	if got := queryOne(t, db, `SELECT COALESCE(count(*),0) FROM experiences WHERE id = ?`, amended.ID); got != "0" {
		t.Fatalf("忘れた行が experiences に残っている: %s 行", got)
	}
	if payload := queryOne(t, db, `SELECT payload FROM events WHERE type='user.forgot' AND session_id = ?`, target.SessionID); !strings.Contains(payload, amended.ID) {
		t.Fatalf("user.forgot マーカーに忘れた id が無い: %q", payload)
	}
	if got := queryOne(t, db, `SELECT COALESCE(count(*),0) FROM surprise_ledger WHERE experience_id = ?`, amended.ID); got != "0" {
		t.Fatalf("rebuild 後も ledger が忘れた経験を参照している: %s 行", got)
	}

	// --- 実測ログ: forget --id は指名行のみ削除のため、amend の旧世代が
	// 現行としてviewへ再浮上するかを観測する（本体側仕様の確認 — 断定しない）---
	view3, err := app.GetMemoryView()
	if err != nil {
		t.Fatal(err)
	}
	if back := findBySessionKind(view3.Experiences, target.SessionID, target.Kind); back != nil {
		t.Logf("観測: forget 後、旧世代 id=%s (extractor_model=%s) が現行として再浮上した",
			back.ID, queryOne(t, db, `SELECT extractor_model FROM experiences_current WHERE id = ?`, back.ID))
	} else {
		t.Logf("観測: forget 後、(session, kind) の行はviewから消えたまま")
	}
}

// seedOneRealSession は chat の実環境1往復（実Provider）で使い捨て台帳に
// 経験を積む — chat_e2e_test.go と同じ道筋の圧縮版（view イベント面）。
func seedOneRealSession(t *testing.T) *App {
	t.Helper()
	var mu sync.Mutex
	var events []map[string]any
	exited := make(chan ExitInfo, 1)

	app := NewApp()
	app.emit = func(name string, data ...interface{}) {
		switch name {
		case eventChatView:
			mu.Lock()
			events = append(events, data[0].(map[string]any))
			mu.Unlock()
		case eventChatExit:
			exited <- data[0].(ExitInfo)
		}
	}
	waitFor := func(what string, match func(ev map[string]any) bool, timeout time.Duration) {
		t.Helper()
		deadline := time.Now().Add(timeout)
		for time.Now().Before(deadline) {
			mu.Lock()
			for _, ev := range events {
				if match(ev) {
					mu.Unlock()
					return
				}
			}
			mu.Unlock()
			time.Sleep(200 * time.Millisecond)
		}
		mu.Lock()
		defer mu.Unlock()
		t.Fatalf("%s が %s 待っても届かない。events:\n%v", what, timeout, events)
	}

	if err := app.SendLine("1たす1の答えを半角数字ひとつだけで答えて"); err != nil {
		t.Fatal(err)
	}
	waitFor(`text イベントの "2"`, func(ev map[string]any) bool {
		return ev["type"] == "text" && strings.Contains(toString(ev["text"]), "2")
	}, 180*time.Second)
	if err := app.SendLine("/exit"); err != nil {
		t.Fatal(err)
	}
	waitFor(`note "どうだった"`, func(ev map[string]any) bool {
		return ev["type"] == "note" && strings.Contains(toString(ev["text"]), "どうだった")
	}, 30*time.Second)
	if err := app.SendLine(""); err != nil { // Feedback は無信号で答える
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
	return app
}

func findBySessionKind(exps []Experience, sessionID, kind string) *Experience {
	for i := range exps {
		if exps[i].SessionID == sessionID && exps[i].Kind == kind {
			return &exps[i]
		}
	}
	return nil
}

// queryOne は検証用の読み取り1発 — memory.go と同じ mode=ro で開き、
// 1値を文字列で返す（行なしは ""）。
func queryOne(t *testing.T, dbPath, query string, args ...any) string {
	t.Helper()
	db, err := openMemoryDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var v string
	if err := db.QueryRow(query, args...).Scan(&v); err != nil {
		return ""
	}
	return v
}
