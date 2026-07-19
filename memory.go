// メモリView (ADR-0001 Decision 3): 顔窓 (internal/facewin/poll.go) と同じ
// 姿勢で本体の単一SQLiteを読み取り専用 (mode=ro) で開き、connections /
// experiences_current / curiosity_queue を導出して見せるだけ。GUIは書かない。
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Connection mirrors one row of connections — the strength Tomo has learned
// for one (kind, scope_key, target). Alpha/Beta drive the frontend's percent
// display; PriorAlpha/PriorBeta let it derive experience count n.
type Connection struct {
	Kind       string  `json:"kind"`
	ScopeKey   string  `json:"scope_key"`
	Target     string  `json:"target"`
	Alpha      float64 `json:"alpha"`
	Beta       float64 `json:"beta"`
	PriorAlpha float64 `json:"prior_alpha"`
	PriorBeta  float64 `json:"prior_beta"`
	LastUpdate int64   `json:"last_update"`
}

// Experience mirrors one row of experiences_current. Context/Outcome ride as
// raw JSON text — formatting them into readable k=v pairs is a View concern
// the frontend owns, not this read path.
type Experience struct {
	ID        string `json:"id"`
	SessionID string `json:"session_id"`
	TS        int64  `json:"ts"`
	Kind      string `json:"kind"`
	Provider  string `json:"provider"` // "" when the row's provider is NULL
	Context   string `json:"context"`
	Outcome   string `json:"outcome"`
}

// CuriosityItem mirrors one pending row of curiosity_queue.
type CuriosityItem struct {
	ID        string  `json:"id"`
	CreatedTS int64   `json:"created_ts"`
	Signal    string  `json:"signal"`
	Payload   string  `json:"payload"`
	Priority  float64 `json:"priority"`
	Status    string  `json:"status"`
}

// MemoryView is the read-only projection GetMemoryView returns. Exists tells
// "台帳がまだ無い" (never ran `tomobit`) apart from "loaded but empty" —
// both leave the slices empty, but only one is worth explaining to the user.
type MemoryView struct {
	DBPath      string          `json:"db_path"`
	Exists      bool            `json:"exists"`
	Connections []Connection    `json:"connections"`
	Experiences []Experience    `json:"experiences"`
	Curiosity   []CuriosityItem `json:"curiosity"`
}

// dbPath mirrors cmd/tomobit/main.go's dbFlag resolution (flag > env >
// config > default), minus the flag — the GUI has no flag seat.
func dbPath() (string, error) {
	if v := os.Getenv("TOMOBIT_DB"); v != "" {
		return v, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	if v := configDBKey(filepath.Join(home, ".tomobit", "config.json")); v != "" {
		return v, nil
	}
	return filepath.Join(home, ".tomobit", "tomobit.db"), nil
}

// configDBKey reads only the "db" key out of config.json. A missing file or
// unparsable JSON falls through silently rather than erroring — this is a
// best-effort peek at one key, not the body's full config.Load (which is
// closed behind the module boundary — ADR-0001 Decision 1 却下対案 — and
// intentionally treats a broken file as fatal; this narrower read does not).
func configDBKey(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var partial struct {
		DB string `json:"db"`
	}
	if err := json.Unmarshal(data, &partial); err != nil {
		return ""
	}
	return partial.DB
}

// openMemoryDB mirrors internal/facewin/poll.go's openRO: mode=ro and a
// single connection so the GUI can never become a second writer, and no
// migration runs — a read-only renderer must not touch the schema.
func openMemoryDB(path string) (*sql.DB, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: abs, RawQuery: "mode=ro&_pragma=busy_timeout(5000)"}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// GetMemoryView opens the DB read-only, reads the three sections, and closes
// it — no pooled connection lingers between calls (顔窓のようにポーリングし
// 続ける器官ではなく、ユーザーが「更新」を押した時だけ覗く)。
func (a *App) GetMemoryView() (MemoryView, error) {
	path, err := dbPath()
	if err != nil {
		return MemoryView{}, fmt.Errorf("db パスの解決に失敗: %w", err)
	}
	view := MemoryView{DBPath: path}

	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return view, nil // 台帳がまだ無い — Exists=false のままフロントへ返す
		}
		return MemoryView{}, fmt.Errorf("db の確認に失敗: %w", err)
	}
	view.Exists = true

	db, err := openMemoryDB(path)
	if err != nil {
		return MemoryView{}, fmt.Errorf("db を読み取り専用で開けない: %w", err)
	}
	defer db.Close()

	if view.Connections, err = queryConnections(db); err != nil {
		return MemoryView{}, err
	}
	if view.Experiences, err = queryExperiences(db); err != nil {
		return MemoryView{}, err
	}
	if view.Curiosity, err = queryCuriosity(db); err != nil {
		return MemoryView{}, err
	}
	return view, nil
}

func queryConnections(db *sql.DB) ([]Connection, error) {
	rows, err := db.Query(`SELECT kind, scope_key, target, alpha, beta, prior_alpha, prior_beta, last_update
		FROM connections ORDER BY last_update DESC`)
	if err != nil {
		return nil, fmt.Errorf("connections の読み取りに失敗: %w", err)
	}
	defer rows.Close()
	out := []Connection{}
	for rows.Next() {
		var c Connection
		if err := rows.Scan(&c.Kind, &c.ScopeKey, &c.Target, &c.Alpha, &c.Beta, &c.PriorAlpha, &c.PriorBeta, &c.LastUpdate); err != nil {
			return nil, fmt.Errorf("connections の読み取りに失敗: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func queryExperiences(db *sql.DB) ([]Experience, error) {
	rows, err := db.Query(`SELECT id, session_id, ts, kind, provider, context, outcome
		FROM experiences_current ORDER BY ts DESC LIMIT 200`)
	if err != nil {
		return nil, fmt.Errorf("experiences の読み取りに失敗: %w", err)
	}
	defer rows.Close()
	out := []Experience{}
	for rows.Next() {
		var e Experience
		var provider sql.NullString
		if err := rows.Scan(&e.ID, &e.SessionID, &e.TS, &e.Kind, &provider, &e.Context, &e.Outcome); err != nil {
			return nil, fmt.Errorf("experiences の読み取りに失敗: %w", err)
		}
		e.Provider = provider.String
		out = append(out, e)
	}
	return out, rows.Err()
}

func queryCuriosity(db *sql.DB) ([]CuriosityItem, error) {
	rows, err := db.Query(`SELECT id, created_ts, signal, payload, priority, status
		FROM curiosity_queue WHERE status='pending' ORDER BY priority DESC, created_ts DESC`)
	if err != nil {
		return nil, fmt.Errorf("curiosity_queue の読み取りに失敗: %w", err)
	}
	defer rows.Close()
	out := []CuriosityItem{}
	for rows.Next() {
		var c CuriosityItem
		if err := rows.Scan(&c.ID, &c.CreatedTS, &c.Signal, &c.Payload, &c.Priority, &c.Status); err != nil {
			return nil, fmt.Errorf("curiosity_queue の読み取りに失敗: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
