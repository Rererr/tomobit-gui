package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// スクロールバックのテストは What = ADR-0003 の4決定: 既定OFFでは1バイトも
// 書かない (Decision 0)、sid 判明まで素通し行をバッファしてまとめて書く
// (Decision 1)、忘却より長生きしない (Decision 2)、総量上限を古い順に削る
// (Decision 3)。

func TestNewScrollbackWriter_既定OFFでは書き手を作らない(t *testing.T) {
	// キー無し(未設定) = OFF: newScrollbackWriter が nil を返し、pumpViewStream は
	// sb == nil で record を一切呼ばない = 1バイトも書かれない。
	if w, _ := (&App{}).newScrollbackWriter(); w != nil {
		t.Errorf("transcript_cache 未設定なのに書き手が作られた")
	}
	off := false
	if w, _ := (&App{guiConfig: GUIConfig{TranscriptCache: &off}}).newScrollbackWriter(); w != nil {
		t.Errorf("transcript_cache=false なのに書き手が作られた")
	}
}

func TestScrollbackWriter_task_started到達までバッファしまとめて書く(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "gui-scrollback")
	var diag []string
	w := &scrollbackWriter{dir: dir, limit: scrollbackTotalLimit, onErr: func(s string) { diag = append(diag, s) }}

	// init/ready/decided は task.started より前に来る — sid が判明するまでバッファ。
	lines := []string{
		`{"type":"ready"}`,
		`{"type":"decided","sid":"s1"}`,
		`{"type":"task.started","sid":"s1","intent":"やあ"}`,
		`{"type":"text","text":"応答"}`,
		`{"type":"turn.finished","duration_ms":10}`,
	}
	for _, l := range lines {
		w.record([]byte(l))
	}
	w.close()

	if len(diag) != 0 {
		t.Fatalf("正常系で診断が出た: %v", diag)
	}
	data, err := os.ReadFile(filepath.Join(dir, "s1.ndjson"))
	if err != nil {
		t.Fatalf("スクロールバックが書かれていない: %v", err)
	}
	got := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	if !reflect.DeepEqual(got, lines) {
		t.Errorf("素通し追記が食い違う\n got=%v\nwant=%v", got, lines)
	}

	fi, err := os.Stat(filepath.Join(dir, "s1.ndjson"))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Errorf("ファイル権限 = %v, want 0600", fi.Mode().Perm())
	}
	di, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if di.Mode().Perm() != 0o700 {
		t.Errorf("ディレクトリ権限 = %v, want 0700", di.Mode().Perm())
	}
}

func TestScrollbackWriter_task_startedが来なければ何も残さない(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "gui-scrollback")
	w := &scrollbackWriter{dir: dir, limit: scrollbackTotalLimit}
	// tomo.greeted 単発のような task.started を持たないセッションは何も残さない
	// （sessions.go の一覧にも出ない — 表示キャッシュだけが生き残るのは不整合）。
	w.record([]byte(`{"type":"ready"}`))
	w.record([]byte(`{"type":"tomo.greeted"}`))
	w.close()
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		entries, _ := os.ReadDir(dir)
		if len(entries) != 0 {
			t.Errorf("task.started 無しなのにファイルが残った: %v", entries)
		}
	}
}

func TestGetSessionScrollback_台帳に無いsidは削除してから無いと答える(t *testing.T) {
	ledger := newTestLedger(t)
	addEvent(t, ledger, "live", 1, 1000, "task.started", `{"intent":"x"}`)
	t.Setenv("TOMOBIT_DB", ledger)

	// スクロールバックは台帳の隣 (dbPath のディレクトリ)/gui-scrollback。
	dir := filepath.Join(filepath.Dir(ledger), "gui-scrollback")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	gonePath := filepath.Join(dir, "gone.ndjson")
	if err := os.WriteFile(gonePath, []byte(`{"type":"task.started","sid":"gone"}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	livePath := filepath.Join(dir, "live.ndjson")
	live := `{"type":"task.started","sid":"live","intent":"x"}` + "\n" + `{"type":"text","text":"hi"}` + "\n"
	if err := os.WriteFile(livePath, []byte(live), 0o600); err != nil {
		t.Fatal(err)
	}

	app := NewApp()

	res, err := app.GetSessionScrollback("gone")
	if err != nil {
		t.Fatal(err)
	}
	if res.Exists {
		t.Errorf("台帳に無い sid なのに Exists=true")
	}
	if _, err := os.Stat(gonePath); !os.IsNotExist(err) {
		t.Errorf("忘却より長生きした — 台帳に無いスクロールバックが削除されていない")
	}

	res, err = app.GetSessionScrollback("live")
	if err != nil {
		t.Fatal(err)
	}
	if !res.Exists || len(res.Events) != 2 {
		t.Errorf("台帳に在る sid の全文が返らない: %+v", res)
	}
	if res.Events[0]["type"] != "task.started" || res.Events[1]["text"] != "hi" {
		t.Errorf("全文の中身が食い違う: %+v", res.Events)
	}
}

func TestEnforceScrollbackLimit_上限超過で古い順に削り書き込み中は守る(t *testing.T) {
	dir := t.TempDir()
	mk := func(name string, mtime time.Time) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, make([]byte, 100), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(p, mtime, mtime); err != nil {
			t.Fatal(err)
		}
		return p
	}
	base := time.Now()
	oldest := mk("a.ndjson", base.Add(-2*time.Hour))
	mid := mk("b.ndjson", base.Add(-1*time.Hour))
	newest := mk("c.ndjson", base)

	// 総量 300、上限 250。keep=oldest は書き込み中として守る。古い順に削るので
	// 非keepの最古 mid が消え、それで 200 <= 250 に収まり newest は残る。
	enforceScrollbackLimit(dir, 250, oldest, nil)

	if _, err := os.Stat(oldest); err != nil {
		t.Errorf("書き込み中(keep)が削除された")
	}
	if _, err := os.Stat(mid); !os.IsNotExist(err) {
		t.Errorf("非keepの最古が削除されていない")
	}
	if _, err := os.Stat(newest); err != nil {
		t.Errorf("上限内に収まったのに新しいファイルまで削られた")
	}
}

func TestScrollbackWriter_同意撤回で以後の書き込みを即止める(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "gui-scrollback")
	on := true
	w := &scrollbackWriter{dir: dir, limit: scrollbackTotalLimit, enabled: func() bool { return on }}
	w.record([]byte(`{"type":"task.started","sid":"s1"}`))
	w.record([]byte(`{"type":"text","text":"before"}`))
	on = false // 走行中に設定を OFF へ撤回
	w.record([]byte(`{"type":"text","text":"after"}`))
	w.close()

	data, err := os.ReadFile(filepath.Join(dir, "s1.ndjson"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "before") {
		t.Errorf("撤回前の行が消えた: %q", data)
	}
	if strings.Contains(string(data), "after") {
		t.Errorf("撤回は即時のはず — 撤回後の行が書かれた: %q", data)
	}
}

func TestPumpViewStream_OFFではスクロールバックを1バイトも生成しない(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TOMOBIT_DB", filepath.Join(dir, "tomobit.db"))
	app := NewApp() // guiConfig ゼロ値 = transcript_cache 未設定 = OFF
	app.emit = func(string, ...interface{}) {}

	sb, _ := app.newScrollbackWriter()
	if sb != nil {
		t.Fatal("OFF なのに書き手が作られた")
	}
	// セッション一式を流す。sb==nil なので pumpViewStream は record を1度も呼ばず、
	// scrollbackDir すら生成しない（`if sb != nil` ガード除去の変異は nil 参照で落ちる）。
	lines := [][]byte{
		[]byte("{\"type\":\"init\"}\n"),
		[]byte("{\"type\":\"ready\"}\n"),
		[]byte("{\"type\":\"task.started\",\"sid\":\"s1\"}\n"),
		[]byte("{\"type\":\"text\",\"text\":\"hi\"}\n"),
		[]byte("{\"type\":\"turn.finished\",\"duration_ms\":1}\n"),
	}
	app.pumpViewStream(&chunkReader{chunks: lines}, sb)

	if _, err := os.Stat(filepath.Join(dir, "gui-scrollback")); !os.IsNotExist(err) {
		t.Errorf("OFF なのに scrollback ディレクトリが生成された")
	}
}

func TestGetSessions_忘却済みsidのスクロールバックを掃き掃除する(t *testing.T) {
	ledger := newTestLedger(t)
	addEvent(t, ledger, "s-live", 1, 1000, "task.started", `{"intent":"生きてる"}`)
	t.Setenv("TOMOBIT_DB", ledger)

	dir := filepath.Join(filepath.Dir(ledger), "gui-scrollback")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	livePath := filepath.Join(dir, "s-live.ndjson")
	orphanPath := filepath.Join(dir, "s-forgotten.ndjson")
	if err := os.WriteFile(livePath, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(orphanPath, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	// GetSessions は台帳を引いた直後に忘却 GC を走らせる (C-1)。
	if _, err := NewApp().GetSessions(); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(orphanPath); !os.IsNotExist(err) {
		t.Errorf("台帳に無い sid のスクロールバックが掃き掃除されていない（忘却より長生きした）")
	}
	if _, err := os.Stat(livePath); err != nil {
		t.Errorf("台帳に在る sid のスクロールバックまで消えた: %v", err)
	}
}

func TestGetSessions_台帳を引けない回はスクロールバックを消さない(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("TOMOBIT_DB", filepath.Join(tmp, "no-such.db"))
	dir := filepath.Join(tmp, "gui-scrollback")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	orphan := filepath.Join(dir, "s-x.ndjson")
	if err := os.WriteFile(orphan, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	// 台帳が無い（照会できない）回は掃き掃除を走らせない — 消してよいのは台帳を
	// 確かめた時だけ (fail-safe: 過渡的な台帳不在で全文を失わせない)。
	if _, err := NewApp().GetSessions(); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(orphan); err != nil {
		t.Errorf("台帳を引けない回にスクロールバックを消した（fail-safe 違反）: %v", err)
	}
}

func TestGUIConfig_transcriptCache後方互換(t *testing.T) {
	dir := t.TempDir()
	load := func(jsonBody string) GUIConfig {
		p := filepath.Join(dir, "gui.json")
		if err := os.WriteFile(p, []byte(jsonBody), 0o600); err != nil {
			t.Fatal(err)
		}
		c, err := loadGUIConfigFile(p)
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	if load(`{"speaking_style":"x"}`).TranscriptCacheEnabled() {
		t.Errorf("キー無し(既存 gui.json)は OFF のはず")
	}
	if !load(`{"transcript_cache":true}`).TranscriptCacheEnabled() {
		t.Errorf("明示 true が ON にならない")
	}
	if load(`{"transcript_cache":false}`).TranscriptCacheEnabled() {
		t.Errorf("明示 false が OFF にならない")
	}
}
