// スクロールバックの永続 (ADR-0003): 端末が自然に持つ「全文の遡り」を GUI に
// 与える表示キャッシュ。chat:view で受けた NDJSON を素通しで 1 セッション 1
// ファイルに追記し (Decision 1)、過去セッションを開くとき台帳へ照会して忘却
// より長生きさせず (Decision 2)、総量上限を古い順に削る (Decision 3)。
// これは「第二の台帳」ではない — 真実は今後も events で、ここからは知覚も
// 記帳も生まれない (ADR-0001 Decision 2)。既定 OFF の同意ゲートの向こう側で
// のみ書く (Decision 0) — ゲートは chat.go の newScrollbackWriter が握る。
package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// scrollbackTotalLimit は全スクロールバックの総量上限 (ADR-0003 Decision 3)。
// 素通し追記は tool_result を含み 1 セッションで数百KBになりうるので、超過分は
// 古い順に消してダイジェスト表示へ落とす。50MB は初期値 — ノブの較正は実運用の
// 実測で決める（Decision 3 が「実測で決める」と明記）。
const scrollbackTotalLimit int64 = 50 * 1024 * 1024

// scrollbackDir は台帳 (dbPath) と同じディレクトリの gui-scrollback を指す。
// 本番では ~/.tomobit/gui-scrollback（ADR-0003 の記載パス）に一致し、機微が
// プレーンテキストで増えるのを経験主権の境界の内側に留める (Consequences)。
// HOME でなく台帳の隣に置くのは、スクロールバックが「その台帳のキャッシュ」で
// あることを場所で示すため — TOMOBIT_DB で台帳を移せばキャッシュも追随し、
// 忘却照会 (sessionInLedger も dbPath 由来) と常に同居する。副次的に、検証は
// TOMOBIT_DB を使い捨てに向けるだけで実 HOME を汚さず隔離できる。
func scrollbackDir() (string, error) {
	path, err := dbPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(path), "gui-scrollback"), nil
}

// safeScrollbackName turns a session id into its file name, rejecting anything
// that could escape scrollbackDir. sid は本体由来だが、ファイル名に使う以上
// path separator や親参照を含む値は保存も読み出しも見送る（防御的）。
func safeScrollbackName(sid string) (string, bool) {
	if sid == "" || sid == "." || sid == ".." ||
		strings.ContainsAny(sid, "/\\") || strings.Contains(sid, "..") ||
		strings.ContainsRune(sid, 0) {
		return "", false
	}
	return sid + ".ndjson", true
}

// scrollbackWriter appends one session's view stream to <sid>.ndjson. sid は
// task.started で判明するので、それ以前の行 (init/ready/decided 等) はバッファ
// して task.started 到達時にまとめて書く。1 セッション = 1 chatProc = 1 sid
// （New chat は /exit でプロセスを区切る — chat.go）なので、writer もプロセスに
// 1 つ、pumpViewStream の単一ゴルーチンからのみ触れる（ロック不要）。
type scrollbackWriter struct {
	dir     string
	limit   int64
	onErr   func(string) // 診断シンク（chat:out の stderr 経路へ1行）
	enabled func() bool  // 各行で現在の同意状態を再照合する（W-1: 撤回の即時反映）
	buf     [][]byte     // sid 判明前の行を溜める
	f       *os.File     // sid 判明後に開く追記先
	// stopped は書き込みを畳んだら立て、以後は静かに no-op になる — 失敗でも
	// 同意撤回でも、チャットを止めず、同じ理由を stderr へ連呼もしない。
	stopped bool
	// live は「今どの窓が書いているか」を答える。窓が複数ある以上、上限の
	// 巻き添えから守るべきファイルは自分1つではない (ADR-0009)。nil のときは
	// 自分だけを守る従来の挙動。
	live func() []string
}

// liveFiles is the set the cap must not delete: every pane's currently-open
// scrollback, plus this one. own が live に含まれない瞬間（自分の窓の proc が
// まだ登録されていない起動直後）があるので、必ず足す。
func (w *scrollbackWriter) liveFiles(own string) map[string]bool {
	keep := map[string]bool{own: true}
	if w.live == nil {
		return keep
	}
	for _, sid := range w.live() {
		if name, ok := safeScrollbackName(sid); ok {
			keep[filepath.Join(w.dir, name)] = true
		}
	}
	return keep
}

// record appends one raw NDJSON view line (改行フレーミングは除去済み)。sid が
// まだ分からなければバッファし、task.started を見た瞬間にファイルを開いて
// バッファを吐き出してから当該行を書く。各行の頭で同意状態を再照合し、設定が
// OFF に撤回されたら現行セッションの以後の書き込みも即座に畳む (W-1)。
func (w *scrollbackWriter) record(raw []byte) {
	if w.stopped {
		return
	}
	if w.enabled != nil && !w.enabled() {
		// 同意の撤回は「次のチャットから」でなく即時 — プロセス起動時に ON だった
		// このセッションの残りも、ユーザーが OFF にした瞬間から書かない。撤回は
		// 診断ではないので stderr へは流さず静かに畳む。
		w.stopSilently()
		return
	}
	line := bytes.TrimSuffix(raw, []byte("\r"))
	if len(line) == 0 {
		return
	}
	if w.f == nil {
		sid := sidFromTaskStarted(line)
		if sid == "" {
			w.buf = append(w.buf, append([]byte(nil), line...))
			return
		}
		if !w.open(sid) {
			return
		}
		for _, b := range w.buf {
			w.writeLine(b)
		}
		w.buf = nil
	}
	w.writeLine(line)
}

// open creates <sid>.ndjson (dir 0700 / file 0600 — 台帳と同じ所有者権限で
// 経験主権の境界の内側) and enforces the total cap at this write moment.
func (w *scrollbackWriter) open(sid string) bool {
	name, ok := safeScrollbackName(sid)
	if !ok {
		w.fail("gui-scrollback: 不正な session id のため保存を見送る: " + sid)
		return false
	}
	if err := os.MkdirAll(w.dir, 0o700); err != nil {
		w.fail("gui-scrollback: ディレクトリ作成に失敗: " + err.Error())
		return false
	}
	path := filepath.Join(w.dir, name)
	// O_NOFOLLOW: 機微を平文で書く先が誰かの張ったシンボリックリンクだったら開かない
	// (S-1) — .tomobit の外へ平文を誘導される経路を塞ぐ。unix 以外では 0（no-op）。
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND|oNoFollow, 0o600)
	if err != nil {
		w.fail("gui-scrollback: ファイルを開けない: " + err.Error())
		return false
	}
	w.f = f
	// 上限チェックは新しいセッションを開くこの瞬間に効かせる (Decision 3:
	// 書き込み時にチェック)。走行中のファイルは消さず、他を古い順に削る。
	//
	// 守るのは自分1つではない (ADR-0009): 窓が複数あれば他の窓も同時に書いて
	// いるので、開いたばかりの自分だけを keep にすると、**走行中の隣の窓の
	// スクロールバックを古い順の巻き添えで消す**。生きている窓ぜんぶを守る。
	enforceScrollbackLimit(w.dir, w.limit, w.liveFiles(path), w.onErr)
	return true
}

// writeLine appends line + "\n". 1 回の Write に閉じて他ライタと行が交差しない
// ようにし、line の裏バッファ (pumpViewStream の carry) を汚さないよう新規確保で
// 改行を足す。
func (w *scrollbackWriter) writeLine(line []byte) {
	if w.stopped {
		return
	}
	out := make([]byte, 0, len(line)+1)
	out = append(out, line...)
	out = append(out, '\n')
	if _, err := w.f.Write(out); err != nil {
		w.fail("gui-scrollback: 書き込みに失敗: " + err.Error())
	}
}

// stopSilently 畳んで以後 no-op にする（同意撤入・正常終了の共通処理）。
func (w *scrollbackWriter) stopSilently() {
	w.stopped = true
	if w.f != nil {
		w.f.Close()
		w.f = nil
	}
	w.buf = nil
}

// fail stops all further writing for this session and reports once. 書き込み
// 失敗はチャットを止めず、以後の record を静かに握り潰す（同じ失敗の連呼を防ぐ）。
func (w *scrollbackWriter) fail(msg string) {
	w.stopSilently()
	if w.onErr != nil {
		w.onErr(msg)
	}
}

// close releases the file at stream EOF. sid を一度も見なかった (task.started の
// 無い単発セッション) 場合はファイルを開かないまま終わる — 何も残さない。
func (w *scrollbackWriter) close() {
	w.stopSilently()
}

// sidFromTaskStarted returns the session id iff line is a task.started event —
// sid が判明する唯一の行 (App.tsx handleViewEvent と同じ: task.started の sid)。
func sidFromTaskStarted(line []byte) string {
	var ev struct {
		Type string `json:"type"`
		Sid  string `json:"sid"`
	}
	if json.Unmarshal(line, &ev) != nil {
		return ""
	}
	if ev.Type != "task.started" {
		return ""
	}
	return ev.Sid
}

// enforceScrollbackLimit deletes .ndjson files oldest-first (by mtime) until the
// total is within limit, never touching keep (the files being written right
// now — one per open pane, ADR-0009).
// 削除は劣化であって喪失ではない — 経験 (台帳) は残っている (ADR-0003 Decision 3)。
//
// これはセッション境界の soft cap (S-2): 開くこの瞬間に他セッションを削って枠を
// 空けるだけで、走行中の keep 自身は上限を超えても削らない（書き込み中のファイルを
// 足元から消さない）。1セッションが単独で上限を超える場合はこの回では収まらず、
// 次のセッション開始時に古い方として回収される — 較正は実運用の実測で決める。
func enforceScrollbackLimit(dir string, limit int64, keep map[string]bool, onErr func(string)) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type finfo struct {
		path  string
		size  int64
		mtime int64
	}
	var files []finfo
	var total int64
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".ndjson") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, finfo{filepath.Join(dir, e.Name()), info.Size(), info.ModTime().UnixNano()})
		total += info.Size()
	}
	if total <= limit {
		return
	}
	// mtime 昇順、同 mtime はファイル名で決定化 (S-3): 同一秒に複数生成された
	// 場合でも削除順が実行ごとにぶれない。
	sort.Slice(files, func(i, j int) bool {
		if files[i].mtime != files[j].mtime {
			return files[i].mtime < files[j].mtime
		}
		return files[i].path < files[j].path
	})
	for _, f := range files {
		if total <= limit {
			break
		}
		if keep[f.path] {
			continue
		}
		if err := os.Remove(f.path); err != nil {
			if onErr != nil {
				onErr("gui-scrollback: 上限超過分の削除に失敗: " + err.Error())
			}
			continue
		}
		total -= f.size
	}
}

// sweepForgottenScrollback deletes every <sid>.ndjson whose sid is not in
// liveSIDs — the台帳 GC for忘却 (C-1 / ADR-0003 Decision 2). GUI は
// forget --session の口を持たない (ADR-0001 Decision 3追記) ので、忘却の器官
// (本体 ADR-0033/0034) が台帳から消したセッションのスクロールバックは、次に
// GUI が台帳を引いた瞬間 (起動時・セッション境界ごとの GetSessions) に追随して
// 消す。never-reopened のセッション — 二度と開かれず GetSessionScrollback の
// 読み込み時検証を踏まないクラス — の平文が永久残留するのを塞ぐ。
//
// liveSIDs は「台帳照会が成功した」証: 呼び出し側 (GetSessions) は events を
// 読み切った後だけここへ来る。照会が失敗した回は呼ばれない = 消さない (既存の
// GetSessionScrollback と同じ fail-safe — 消してよいのは台帳を確かめた時だけ)。
// 掃き掃除自体の失敗 (dir 未生成・個別 Remove 失敗) は握る: 一覧取得は止めない。
func sweepForgottenScrollback(liveSIDs map[string]bool) {
	dir, err := scrollbackDir()
	if err != nil {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".ndjson") {
			continue
		}
		if liveSIDs[strings.TrimSuffix(name, ".ndjson")] {
			continue
		}
		os.Remove(filepath.Join(dir, name))
	}
}

// SessionScrollback is one past session's full transcript for the frontend to
// re-render with the live event→block reducer. Exists=false は全文が無い合図で、
// SessionPane はダイジェスト表示へフォールバックする。
type SessionScrollback struct {
	Exists bool                     `json:"exists"`
	Events []map[string]interface{} `json:"events"`
}

// GetSessionScrollback returns the stored transcript for sessionID, honoring
// forgetting first (ADR-0003 Decision 2): 台帳に無い sid のスクロールバックは
// 削除してから「無い」と答える — 忘却の器官の到達範囲外に漏らさない。
func (a *App) GetSessionScrollback(sessionID string) (SessionScrollback, error) {
	dir, err := scrollbackDir()
	if err != nil {
		return SessionScrollback{}, fmt.Errorf("scrollback パスの解決に失敗: %w", err)
	}
	name, ok := safeScrollbackName(sessionID)
	if !ok {
		return SessionScrollback{Exists: false, Events: []map[string]interface{}{}}, nil
	}
	path := filepath.Join(dir, name)

	inLedger, err := sessionInLedger(sessionID)
	if err != nil {
		// 照会自体の失敗（DB破損・IOエラー）では消さない: 消してよいのは
		// 「台帳を確かめた上で確かに無い」ときだけ。過渡的失敗で全文を失わせない。
		return SessionScrollback{}, err
	}
	if !inLedger {
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return SessionScrollback{}, fmt.Errorf("忘却済みスクロールバックの削除に失敗: %w", err)
		}
		return SessionScrollback{Exists: false, Events: []map[string]interface{}{}}, nil
	}

	events, found, err := readScrollback(path)
	if err != nil {
		return SessionScrollback{}, err
	}
	if !found {
		return SessionScrollback{Exists: false, Events: []map[string]interface{}{}}, nil
	}
	return SessionScrollback{Exists: true, Events: events}, nil
}

// readScrollback parses <sid>.ndjson into raw view events. 壊れた1行は黙って
// 飛ばす — 表示キャッシュなので、途中の不正行1つで全文を捨てるより残りを見せる。
func readScrollback(path string) ([]map[string]interface{}, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("スクロールバックの読み取りに失敗: %w", err)
	}
	events := []map[string]interface{}{}
	for _, line := range bytes.Split(data, []byte("\n")) {
		line = bytes.TrimSuffix(line, []byte("\r"))
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var ev map[string]interface{}
		if json.Unmarshal(line, &ev) != nil {
			continue
		}
		events = append(events, ev)
	}
	return events, true, nil
}

// sessionInLedger reports whether sessionID still has any event in the ledger —
// the forgetting check for Decision 2. DB 自体が無ければ「無い」(全消しと同義)、
// 照会エラーは呼び出し側へ返して削除を保留させる。
func sessionInLedger(sessionID string) (bool, error) {
	path, err := dbPath()
	if err != nil {
		return false, fmt.Errorf("db パスの解決に失敗: %w", err)
	}
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("db の確認に失敗: %w", err)
	}
	db, err := openMemoryDB(path)
	if err != nil {
		return false, fmt.Errorf("db を読み取り専用で開けない: %w", err)
	}
	defer db.Close()

	var one int
	err = db.QueryRow(`SELECT 1 FROM events WHERE session_id = ? LIMIT 1`, sessionID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("台帳の照会に失敗: %w", err)
	}
	return true, nil
}
