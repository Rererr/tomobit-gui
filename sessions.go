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
	// Verdict は人がこのセッションに置いた第2層の判定 (本体 ADR-0055)。
	// "up" | "down" | "" で、"" は「まだ判定していない」と「取り消した」の
	// 両方 — 台帳では別の出来事だが、いまの状態としては同じである。
	// 一覧に出すのは印だけで、判定そのものは詳細から置く。
	Verdict string `json:"verdict"`
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
	// Verdict は SessionDigest のそれと同じ — 詳細を開いた人が、いま何が
	// 置かれているかを見てから置き換えたり取り消したりできるように。
	Verdict string `json:"verdict"`
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
		WHERE type IN ('task.started', 'task.turn', 'task.finished', 'task.cancelled', 'user.verdict')
		ORDER BY session_id, seq`)
	if err != nil {
		return SessionList{}, fmt.Errorf("events の読み取りに失敗: %w", err)
	}
	defer rows.Close()

	bySession := map[string]*SessionDigest{}
	// liveSIDs は台帳に生きているセッションの集合 — スクロールバックの忘却 GC
	// (C-1) の照合基準。ここに無い sid のファイルは、台帳から消えた=忘却済み。
	liveSIDs := map[string]bool{}
	for rows.Next() {
		var sid, typ, payload string
		var ts int64
		if err := rows.Scan(&sid, &ts, &typ, &payload); err != nil {
			return SessionList{}, fmt.Errorf("events の読み取りに失敗: %w", err)
		}
		liveSIDs[sid] = true
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
		case "user.verdict":
			// 最後が勝つ (本体 ADR-0055): 判定を変えたこと自体も台帳に残るが、
			// 一覧が見せるのは「いまの判定」である。"clear" は取り消しなので
			// 印を外す — 本体の parseDeterministic が "" へ写すのと同じ扱い。
			d.Verdict = currentVerdict(payloadString(payload, "verdict"))
		}
	}
	if err := rows.Err(); err != nil {
		return SessionList{}, fmt.Errorf("events の読み取りに失敗: %w", err)
	}

	// 台帳を読み切った直後に忘却 GC を走らせる (C-1): 起動時・セッション境界ごとに
	// GetSessions は呼ばれるので、忘却の器官が消したセッションのスクロールバックは
	// 次に GUI が台帳を見たこの瞬間に追随して消える。best-effort — 一覧は止めない。
	sweepForgottenScrollback(liveSIDs)

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
		case "user.verdict":
			detail.Verdict = currentVerdict(payloadString(payload, "verdict"))
		}
	}
	return detail, rows.Err()
}

// currentVerdict maps one user.verdict payload to what the screen should show.
// "clear" は取り消しなので "" になり、未知の語も "" になる — 本体の語彙が
// 増えたとき、GUIが知らない判定を勝手に 👍 か 👎 のどちらかに描くよりは、
// 「まだ何も置かれていない」と見えている方が嘘が小さい（ADR-0032 の
// 消費者規律: 知らないものは無視する）。
func currentVerdict(word string) string {
	switch word {
	case "up", "down":
		return word
	default:
		return ""
	}
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
