// セッション一覧View (ADR-0001 Consequences): 過去セッションの完全な会話ログは
// 台帳から再構成できない — events が持つのは知覚用ダイジェスト。ここは
// そのダイジェストを要約して見せるだけの読み取り専用Viewで、ライブセッションが
// 正であることは変えない。未知のイベント型は無視する(本体の語彙が増えても
// 壊れない — ADR-0032 の消費者規律と同じ)。
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"sort"
)

// SessionDigest is one past session's summary row for the sidebar.
type SessionDigest struct {
	SessionID string `json:"session_id"`
	StartTS   int64  `json:"start_ts"`
	EndTS     int64  `json:"end_ts"`
	Intent    string `json:"intent"`
	Turns     int    `json:"turns"`  // task.started + task.turn の数
	Status    string `json:"status"` // "finished" | "cancelled" | "open"
	Source    string `json:"source"` // "production" | "learning" | ""
}

// SessionList mirrors MemoryView's Exists semantics: 台帳がまだ無いのか、
// あるが空なのかを呼び出し側が言い分けられるように。
type SessionList struct {
	Exists   bool            `json:"exists"`
	Sessions []SessionDigest `json:"sessions"`
}

// DigestItem is one line of a session's digest timeline.
type DigestItem struct {
	Kind string `json:"kind"` // "user" | "tomo" | "tool" | "provider" | "error"
	Text string `json:"text"`
	N    int    `json:"n"` // user のターン番号(それ以外は0)
}

// SessionDetail is the digest view of one past session.
type SessionDetail struct {
	SessionID string       `json:"session_id"`
	StartTS   int64        `json:"start_ts"`
	Status    string       `json:"status"`
	Items     []DigestItem `json:"items"`
}

// maxSessions caps the sidebar list the way experiences cap at 200 —
// a display bound, not a truth bound.
const maxSessions = 100

// GetSessions lists past task sessions, newest first. Sessions without a
// task.started (e.g. tomo.greeted の単発) are not tasks and do not appear.
func (a *App) GetSessions() (SessionList, error) {
	path, err := dbPath()
	if err != nil {
		return SessionList{}, fmt.Errorf("db パスの解決に失敗: %w", err)
	}
	list := SessionList{Sessions: []SessionDigest{}}
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return list, nil
		}
		return SessionList{}, fmt.Errorf("db の確認に失敗: %w", err)
	}
	list.Exists = true

	db, err := openMemoryDB(path)
	if err != nil {
		return SessionList{}, fmt.Errorf("db を読み取り専用で開けない: %w", err)
	}
	defer db.Close()

	rows, err := db.Query(`SELECT session_id, ts, type, payload FROM events
		WHERE type IN ('task.started', 'task.turn', 'task.finished', 'task.cancelled')
		ORDER BY session_id, seq`)
	if err != nil {
		return SessionList{}, fmt.Errorf("events の読み取りに失敗: %w", err)
	}
	defer rows.Close()

	bySession := map[string]*SessionDigest{}
	for rows.Next() {
		var sid, typ, payload string
		var ts int64
		if err := rows.Scan(&sid, &ts, &typ, &payload); err != nil {
			return SessionList{}, fmt.Errorf("events の読み取りに失敗: %w", err)
		}
		d := bySession[sid]
		if d == nil {
			d = &SessionDigest{SessionID: sid, StartTS: ts, Status: "open"}
			bySession[sid] = d
		}
		if ts > d.EndTS {
			d.EndTS = ts
		}
		switch typ {
		case "task.started":
			d.Intent = payloadString(payload, "intent")
			d.Source = payloadString(payload, "source")
			d.StartTS = ts
			d.Turns++
		case "task.turn":
			d.Turns++
		case "task.finished":
			d.Status = "finished"
		case "task.cancelled":
			d.Status = "cancelled"
		}
	}
	if err := rows.Err(); err != nil {
		return SessionList{}, fmt.Errorf("events の読み取りに失敗: %w", err)
	}

	for _, d := range bySession {
		if d.Intent == "" {
			continue // task.started を持たない = タスクのセッションではない
		}
		list.Sessions = append(list.Sessions, *d)
	}
	sort.Slice(list.Sessions, func(i, j int) bool {
		return list.Sessions[i].StartTS > list.Sessions[j].StartTS
	})
	if len(list.Sessions) > maxSessions {
		list.Sessions = list.Sessions[:maxSessions]
	}
	return list, nil
}

// GetSessionDigest reconstructs one session's digest timeline: ユーザーの
// ターン(intent)・Tomoの本文ダイジェスト・ツール名・Provider・エラー。
func (a *App) GetSessionDigest(sessionID string) (SessionDetail, error) {
	path, err := dbPath()
	if err != nil {
		return SessionDetail{}, fmt.Errorf("db パスの解決に失敗: %w", err)
	}
	db, err := openMemoryDB(path)
	if err != nil {
		return SessionDetail{}, fmt.Errorf("db を読み取り専用で開けない: %w", err)
	}
	defer db.Close()

	rows, err := db.Query(`SELECT ts, type, payload FROM events
		WHERE session_id = ? ORDER BY seq`, sessionID)
	if err != nil {
		return SessionDetail{}, fmt.Errorf("events の読み取りに失敗: %w", err)
	}
	defer rows.Close()

	detail := SessionDetail{SessionID: sessionID, Status: "open", Items: []DigestItem{}}
	for rows.Next() {
		var typ, payload string
		var ts int64
		if err := rows.Scan(&ts, &typ, &payload); err != nil {
			return SessionDetail{}, fmt.Errorf("events の読み取りに失敗: %w", err)
		}
		if detail.StartTS == 0 {
			detail.StartTS = ts
		}
		switch typ {
		case "task.started":
			detail.Items = append(detail.Items, DigestItem{Kind: "user", Text: payloadString(payload, "intent"), N: 1})
		case "task.turn":
			detail.Items = append(detail.Items, DigestItem{
				Kind: "user", Text: payloadString(payload, "intent"), N: payloadInt(payload, "n")})
		case "provider.output":
			if tool := payloadString(payload, "tool"); tool != "" {
				detail.Items = append(detail.Items, DigestItem{Kind: "tool", Text: tool})
			} else if text := payloadString(payload, "text"); text != "" {
				detail.Items = append(detail.Items, DigestItem{Kind: "tomo", Text: text})
			}
		case "provider.selected":
			text := payloadString(payload, "provider")
			if model := payloadString(payload, "model"); model != "" {
				text += " (" + model + ")"
			}
			detail.Items = append(detail.Items, DigestItem{Kind: "provider", Text: text})
		case "provider.error":
			detail.Items = append(detail.Items, DigestItem{Kind: "error", Text: payloadString(payload, "message")})
		case "task.finished":
			detail.Status = "finished"
		case "task.cancelled":
			detail.Status = "cancelled"
		}
	}
	return detail, rows.Err()
}

// payloadString reads one string key out of an event payload. 壊れたJSONや
// 型違いは "" — ダイジェスト1行の欠けで一覧全体を落とさない。
func payloadString(payload, key string) string {
	var m map[string]any
	if err := json.Unmarshal([]byte(payload), &m); err != nil {
		return ""
	}
	s, _ := m[key].(string)
	return s
}

func payloadInt(payload, key string) int {
	var m map[string]any
	if err := json.Unmarshal([]byte(payload), &m); err != nil {
		return 0
	}
	f, _ := m[key].(float64)
	return int(f)
}
