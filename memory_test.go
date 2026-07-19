package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// testSchema reproduces the shape of internal/store/store.go's schema (SCHEMA.md
// v1.0) — the three tables/view GetMemoryView reads, minimal (no triggers, no
// surprise_ledger) since this is a read path, not a migration test.
const testSchema = `
CREATE TABLE experiences (
  id              TEXT    PRIMARY KEY,
  session_id      TEXT    NOT NULL,
  ts              INTEGER NOT NULL,
  kind            TEXT    NOT NULL,
  extractor_ver   INTEGER NOT NULL,
  extractor_model TEXT    NOT NULL,
  context         TEXT    NOT NULL,
  provider        TEXT,
  outcome         TEXT    NOT NULL,
  source          TEXT    NOT NULL DEFAULT 'production'
);

CREATE VIEW experiences_current AS
  SELECT * FROM experiences e
  WHERE e.extractor_ver = (
    SELECT max(extractor_ver) FROM experiences
    WHERE session_id = e.session_id AND kind = e.kind
  );

CREATE TABLE connections (
  kind        TEXT    NOT NULL,
  scope_key   TEXT    NOT NULL,
  target      TEXT    NOT NULL,
  alpha       REAL    NOT NULL,
  beta        REAL    NOT NULL,
  last_update INTEGER NOT NULL,
  born_ts     INTEGER NOT NULL,
  parent_key  TEXT,
  prior_alpha REAL    NOT NULL DEFAULT 1,
  prior_beta  REAL    NOT NULL DEFAULT 1,
  PRIMARY KEY (kind, scope_key, target)
);

CREATE TABLE curiosity_queue (
  id          TEXT    PRIMARY KEY,
  created_ts  INTEGER NOT NULL,
  signal      TEXT    NOT NULL,
  payload     TEXT    NOT NULL,
  priority    REAL    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending',
  resolved_ts INTEGER
);
`

func newTestLedger(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "tomobit.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(testSchema); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestGetMemoryView_三セクションを読み取り台帳は変更しない(t *testing.T) {
	path := newTestLedger(t)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(`INSERT INTO connections (kind, scope_key, target, alpha, beta, last_update, born_ts, prior_alpha, prior_beta)
		VALUES ('preference', 'gui', 'concise', 3, 1, 1000, 1, 1, 1)`)
	// 古い extractor_ver の行は experiences_current から除外されるはず。
	mustExec(`INSERT INTO experiences (id, session_id, ts, kind, extractor_ver, extractor_model, context, provider, outcome)
		VALUES ('e1', 's1', 100, 'execution', 1, 'qwen3:8b', '{"a":1}', 'claude-code', '{"adopted":"as-is"}')`)
	mustExec(`INSERT INTO experiences (id, session_id, ts, kind, extractor_ver, extractor_model, context, provider, outcome)
		VALUES ('e2', 's1', 200, 'execution', 2, 'qwen3:8b', '{"a":2}', NULL, '{"adopted":"as-is"}')`)
	mustExec(`INSERT INTO curiosity_queue (id, created_ts, signal, payload, priority, status)
		VALUES ('c1', 300, 'surprise', '{"target":"x"}', 0.8, 'pending')`)
	mustExec(`INSERT INTO curiosity_queue (id, created_ts, signal, payload, priority, status)
		VALUES ('c2', 400, 'surprise', '{"target":"y"}', 0.9, 'done')`)

	t.Setenv("TOMOBIT_DB", path)
	app := NewApp()
	view, err := app.GetMemoryView()
	if err != nil {
		t.Fatal(err)
	}

	if !view.Exists {
		t.Error("既存のdbなのにExists=false")
	}
	if view.DBPath != path {
		t.Errorf("DBPath = %q, want %q", view.DBPath, path)
	}
	if len(view.Connections) != 1 || view.Connections[0].Target != "concise" {
		t.Errorf("Connections = %+v", view.Connections)
	}
	if len(view.Experiences) != 1 || view.Experiences[0].ID != "e2" {
		t.Errorf("Experiences should keep only the max extractor_ver row: %+v", view.Experiences)
	}
	if view.Experiences[0].Provider != "" {
		t.Errorf("NULL provider should surface as empty string, got %q", view.Experiences[0].Provider)
	}
	if len(view.Curiosity) != 1 || view.Curiosity[0].ID != "c1" {
		t.Errorf("Curiosity should keep only pending rows: %+v", view.Curiosity)
	}

	// 読み取り専用: 呼び出し後もファイルへの書き込みは発生していない。
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Size() == 0 {
		t.Fatal("test ledger unexpectedly empty")
	}
}

func TestGetMemoryView_DB無しはExistsFalseでエラーにならない(t *testing.T) {
	t.Setenv("TOMOBIT_DB", filepath.Join(t.TempDir(), "no-such.db"))
	app := NewApp()
	view, err := app.GetMemoryView()
	if err != nil {
		t.Fatal(err)
	}
	if view.Exists {
		t.Error("存在しないdbなのにExists=true")
	}
	if len(view.Connections) != 0 || len(view.Experiences) != 0 || len(view.Curiosity) != 0 {
		t.Errorf("dbが無いのに中身が入っている: %+v", view)
	}
}

func TestDBPath_envが最優先(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("TOMOBIT_DB", "/explicit/env/path.db")
	got, err := dbPath()
	if err != nil {
		t.Fatal(err)
	}
	if got != "/explicit/env/path.db" {
		t.Errorf("dbPath() = %q, want env value", got)
	}
}

func TestDBPath_envが無ければconfigのdbキー(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("TOMOBIT_DB", "")
	if err := os.MkdirAll(filepath.Join(home, ".tomobit"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfgPath := filepath.Join(home, ".tomobit", "config.json")
	if err := os.WriteFile(cfgPath, []byte(`{"db":"/from/config.db","claude_args":["--x"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := dbPath()
	if err != nil {
		t.Fatal(err)
	}
	if got != "/from/config.db" {
		t.Errorf("dbPath() = %q, want config db key", got)
	}
}

func TestDBPath_envもconfigも無ければ既定パス(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("TOMOBIT_DB", "")
	got, err := dbPath()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, ".tomobit", "tomobit.db")
	if got != want {
		t.Errorf("dbPath() = %q, want %q", got, want)
	}
}

func TestConfigDBKey_ファイル無しや壊れたJSONは空文字で次へ(t *testing.T) {
	dir := t.TempDir()
	if got := configDBKey(filepath.Join(dir, "no-such.json")); got != "" {
		t.Errorf("missing file: configDBKey() = %q, want empty", got)
	}
	broken := filepath.Join(dir, "broken.json")
	if err := os.WriteFile(broken, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := configDBKey(broken); got != "" {
		t.Errorf("broken JSON: configDBKey() = %q, want empty", got)
	}
}
