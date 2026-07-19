package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	_ "modernc.org/sqlite"
)

// ステージ導出のテストは What = ADR-0017 のゲート列: 量(毛玉/あかちゃん) →
// 較正(こども) → 鋭さ(わかもの) → 好みの証拠(おとな/あいぼう)。
// 時刻は now 固定・last_update ≈ now で減衰をほぼ1にして境界だけを見る。

const stageTestNow = int64(1_750_000_000_000)

// stageLedger opens a fixture ledger and returns an exec helper and the path.
func stageLedger(t *testing.T) (*sql.DB, string) {
	t.Helper()
	path := newTestLedger(t)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, path
}

func mustExecDB(t *testing.T, db *sql.DB, query string, args ...interface{}) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

// addCapability は evidence≈3 (α=4,β=1, prior 1,1) でゲートを通る capability。
func addCapability(t *testing.T, db *sql.DB, scopeKey, provider string) {
	t.Helper()
	mustExecDB(t, db, `INSERT INTO connections (kind, scope_key, target, alpha, beta, last_update, born_ts, prior_alpha, prior_beta)
		VALUES ('capability', ?, ?, 4, 1, ?, 1, 1, 1)`, scopeKey, provider, stageTestNow)
}

// addCalibrationEntry は s_excess=0 の台帳エントリ — 較正ゲートを通す。
func addCalibrationEntry(t *testing.T, db *sql.DB, scopeKey, provider string) {
	t.Helper()
	mustExecDB(t, db, `INSERT INTO surprise_ledger (kind, scope_key, target, experience_id, ts, p, y, s_excess)
		VALUES ('capability', ?, ?, 'x', ?, 0.8, 1, 0)`, scopeKey, provider, stageTestNow)
}

// addExecutions は島の到来頻度を積む(3件 ≈ freq 3 ≥ 2.5)。
func addExecutions(t *testing.T, db *sql.DB, contextJSON string, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		mustExecDB(t, db, `INSERT INTO experiences (id, session_id, ts, kind, extractor_ver, extractor_model, context, provider, outcome)
			VALUES (?, 's1', ?, 'execution', 1, 'm', ?, 'claude-code', '{}')`,
			"e"+string(rune('a'+i)), stageTestNow-int64(i), contextJSON)
	}
}

func stageOf(t *testing.T, db *sql.DB) int {
	t.Helper()
	stage, err := stageFromDB(db, stageTestNow)
	if err != nil {
		t.Fatal(err)
	}
	return stage
}

func TestStage_接続ゼロは毛玉(t *testing.T) {
	db, _ := stageLedger(t)
	if got := stageOf(t, db); got != 0 {
		t.Errorf("stage = %d (%s), want 0 (毛玉)", got, stageNames[got])
	}
}

func TestStage_証拠3未満はあかちゃん(t *testing.T) {
	db, _ := stageLedger(t)
	mustExecDB(t, db, `INSERT INTO connections (kind, scope_key, target, alpha, beta, last_update, born_ts, prior_alpha, prior_beta)
		VALUES ('capability', 'lang=go', 'claude-code', 2, 1, ?, 1, 1, 1)`, stageTestNow)
	if got := stageOf(t, db); got != 1 {
		t.Errorf("stage = %d (%s), want 1 (あかちゃん)", got, stageNames[got])
	}
}

func TestStage_台帳エントリ無しは較正未定義でこども(t *testing.T) {
	db, _ := stageLedger(t)
	addCapability(t, db, "lang=go", "claude-code")
	if got := stageOf(t, db); got != 2 {
		t.Errorf("stage = %d (%s), want 2 (こども)", got, stageNames[got])
	}
}

func TestStage_較正済みでも二者の抽選が揺れるならわかもの(t *testing.T) {
	db, _ := stageLedger(t)
	// 同じ島に好みの知識が無い2 Provider — Beta(1,1) 同士の抽選は揺れる。
	addCapability(t, db, "lang=go", "claude-code")
	addCapability(t, db, "lang=go", "codex")
	addCalibrationEntry(t, db, "lang=go", "claude-code")
	addExecutions(t, db, `{"lang":"go"}`, 3)
	if got := stageOf(t, db); got != 3 {
		t.Errorf("stage = %d (%s), want 3 (わかもの)", got, stageNames[got])
	}
}

func TestStage_迷わない島だけならおとな(t *testing.T) {
	db, _ := stageLedger(t)
	addCapability(t, db, "lang=go", "claude-code")
	addCalibrationEntry(t, db, "lang=go", "claude-code")
	addExecutions(t, db, `{"lang":"go"}`, 3)
	if got := stageOf(t, db); got != 4 {
		t.Errorf("stage = %d (%s), want 4 (おとな)", got, stageNames[got])
	}
}

func TestStage_好みの証拠が積まれるとあいぼう(t *testing.T) {
	db, _ := stageLedger(t)
	addCapability(t, db, "lang=go", "claude-code")
	addCalibrationEntry(t, db, "lang=go", "claude-code")
	addExecutions(t, db, `{"lang":"go"}`, 3)
	mustExecDB(t, db, `INSERT INTO connections (kind, scope_key, target, alpha, beta, last_update, born_ts, prior_alpha, prior_beta)
		VALUES ('preference', '', 'claude-code~codex', 2, 1, ?, 1, 1, 1)`, stageTestNow)
	if got := stageOf(t, db); got != 5 {
		t.Errorf("stage = %d (%s), want 5 (あいぼう)", got, stageNames[got])
	}
}

func TestStage_導出は決定的(t *testing.T) {
	db, _ := stageLedger(t)
	addCapability(t, db, "lang=go", "claude-code")
	addCapability(t, db, "lang=go", "codex")
	addCalibrationEntry(t, db, "lang=go", "claude-code")
	addExecutions(t, db, `{"lang":"go"}`, 3)
	first := stageOf(t, db)
	for i := 0; i < 3; i++ {
		if got := stageOf(t, db); got != first {
			t.Fatalf("同じ台帳・同じ時刻でステージが揺れた: %d != %d", got, first)
		}
	}
}

// 本体実装との照合(opt-in): 本体リポジトリを一時コピーし、参照値を
//
//	go run ./cmd/stagecheck <db> <nowMs>  (internal/face.StageFrom を直接呼ぶ小物)
//
// で出してから、STAGE_XCHECK_DB / STAGE_XCHECK_NOW / STAGE_XCHECK_WANT を
// 渡して走らせる。移植(tomobit d4e2412)のドリフト検知は本体の公開API化までは
// この手動照合だけが頼り。
func TestStage_本体実装との照合(t *testing.T) {
	path := os.Getenv("STAGE_XCHECK_DB")
	if path == "" {
		t.Skip("STAGE_XCHECK_DB 指定時のみ")
	}
	now, err := strconv.ParseInt(os.Getenv("STAGE_XCHECK_NOW"), 10, 64)
	if err != nil {
		t.Fatalf("STAGE_XCHECK_NOW: %v", err)
	}
	want, err := strconv.Atoi(os.Getenv("STAGE_XCHECK_WANT"))
	if err != nil {
		t.Fatalf("STAGE_XCHECK_WANT: %v", err)
	}
	db, err := openMemoryDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	got, err := stageFromDB(db, now)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Errorf("GUI移植 stage = %d (%s), 本体 = %d — 移植がドリフトしている", got, stageNames[got], want)
	}
}

func TestGetTomoStatus_DB無しはExistsFalse(t *testing.T) {
	t.Setenv("TOMOBIT_DB", filepath.Join(t.TempDir(), "no-such.db"))
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Exists {
		t.Error("存在しないdbなのにExists=true")
	}
}

func TestGetTomoStatus_台帳からステージ名を返す(t *testing.T) {
	_, path := stageLedger(t)
	t.Setenv("TOMOBIT_DB", path)
	status, err := NewApp().GetTomoStatus()
	if err != nil {
		t.Fatal(err)
	}
	if !status.Exists {
		t.Fatal("既存のdbなのにExists=false")
	}
	if status.Stage != 0 || status.StageName != "毛玉" {
		t.Errorf("status = %+v, want stage 0 毛玉", status)
	}
}
