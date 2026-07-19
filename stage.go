// Tomo名ヘッダのステージView (ADR-0001 Decision 5): `Tomo · <ステージ名>` の
// テキスト導出。器官の再実装はしない(Decision 1)が、このテキストViewだけは
// Decision 5 が明示的に許す — ADR-0025 のテキストフォールバックと同じ位置づけ。
//
// 導出式は本体 internal/face/stage.go とその依存
// (internal/core/{beta,betamath,scope,types}.go, internal/decide/decide.go)
// の忠実な移植(tomobit d4e2412 時点)。同じ台帳・同じ時刻なら顔窓と同じ
// ステージを出すため、較正ノブ(θ等)・乱数の呼び出し順まで本体と揃えている。
// 本体側でノブや式が変わったらここも追随が要る(internal/ はモジュール境界で
// 閉じており import できない — ADR-0001 Decision 1 却下対案)。
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"math/rand"
	"os"
	"sort"
	"strings"
	"time"
	"unicode"
)

// TomoStatus is the header's View. Exists follows MemoryView's semantics:
// false means the ledger has never been created (the header shows a bare
// "Tomo" — 台帳が無いのに毛玉が居るとは言わない).
type TomoStatus struct {
	Exists    bool   `json:"exists"`
	Stage     int    `json:"stage"`
	StageName string `json:"stage_name"`
}

// Growth stages and labels (本体 internal/face/stage.go).
var stageNames = [...]string{"毛玉", "あかちゃん", "こども", "わかもの", "おとな", "あいぼう"}

// Knobs (本体 ADR-0017 / ADR-0012 / ADR-0002 — 較正はdogfoodで動くため要追随).
const (
	halfLifeMs    = 90 * 24 * 3600 * 1000
	priorAlpha    = 1.0
	priorBeta     = 1.0
	thetaCal      = 0.15
	thetaSharp    = 0.2
	islandMinFreq = 2.5
	sharpDraws    = 128
	stageSeed     = 1
	quantileQ     = 0.20
	gateMargin    = 0.02
	blankQuantile = quantileQ
)

// ledgerEntry is one surprise_ledger row, reduced to what calibration reads.
type ledgerEntry struct {
	TS      int64
	SExcess float64
}

// stageExperience is one experiences_current row, reduced to what the
// sharpness gate reads (island arrival frequency).
type stageExperience struct {
	Kind   string
	TS     int64
	Tokens []string
}

// GetTomoStatus derives the growth stage from the ledger, read-only — the
// same open/close discipline as GetMemoryView (開いて読んで閉じる).
func (a *App) GetTomoStatus() (TomoStatus, error) {
	path, err := dbPath()
	if err != nil {
		return TomoStatus{}, fmt.Errorf("db パスの解決に失敗: %w", err)
	}
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return TomoStatus{}, nil
		}
		return TomoStatus{}, fmt.Errorf("db の確認に失敗: %w", err)
	}
	db, err := openMemoryDB(path)
	if err != nil {
		return TomoStatus{}, fmt.Errorf("db を読み取り専用で開けない: %w", err)
	}
	defer db.Close()

	stage, err := stageFromDB(db, time.Now().UnixMilli())
	if err != nil {
		return TomoStatus{}, err
	}
	return TomoStatus{Exists: true, Stage: stage, StageName: stageNames[stage]}, nil
}

// stageFromDB reads the three projections the stage function consumes and
// reduces them (本体 face.StageFrom と同じ手順).
func stageFromDB(db *sql.DB, nowMs int64) (int, error) {
	conns, err := queryConnections(db)
	if err != nil {
		return 0, err
	}
	ledger, err := queryStageLedger(db)
	if err != nil {
		return 0, err
	}
	exps, err := queryStageExperiences(db)
	if err != nil {
		return 0, err
	}
	return stageFrom(conns, ledger, exps, nowMs), nil
}

// queryStageLedger reads every surprise_ledger entry that belongs to a live
// connection — 本体は connections を回して LedgerFor する(重複キーはPKで無い)
// ので、JOIN での一括読みは同じ多重集合になる。
func queryStageLedger(db *sql.DB) ([]ledgerEntry, error) {
	rows, err := db.Query(`SELECT l.ts, l.s_excess FROM surprise_ledger l
		JOIN connections c ON c.kind = l.kind AND c.scope_key = l.scope_key AND c.target = l.target`)
	if err != nil {
		return nil, fmt.Errorf("surprise_ledger の読み取りに失敗: %w", err)
	}
	defer rows.Close()
	out := []ledgerEntry{}
	for rows.Next() {
		var e ledgerEntry
		if err := rows.Scan(&e.TS, &e.SExcess); err != nil {
			return nil, fmt.Errorf("surprise_ledger の読み取りに失敗: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// queryStageExperiences reads experiences_current without the display path's
// LIMIT — 頻度和は全経験に効く(古い分は減衰が消すが、切り捨てとは違う)。
func queryStageExperiences(db *sql.DB) ([]stageExperience, error) {
	rows, err := db.Query(`SELECT kind, ts, context FROM experiences_current`)
	if err != nil {
		return nil, fmt.Errorf("experiences の読み取りに失敗: %w", err)
	}
	defer rows.Close()
	out := []stageExperience{}
	for rows.Next() {
		var e stageExperience
		var context string
		if err := rows.Scan(&e.Kind, &e.TS, &context); err != nil {
			return nil, fmt.Errorf("experiences の読み取りに失敗: %w", err)
		}
		e.Tokens = contextTokens(context)
		out = append(out, e)
	}
	return out, rows.Err()
}

// contextTokens は本体 Experience.Tokens: context の属性を正準トークン
// "key=value" (小文字・trim・制御文字除去) に落としてソートする。
func contextTokens(contextJSON string) []string {
	var ctx map[string]string
	if err := json.Unmarshal([]byte(contextJSON), &ctx); err != nil {
		return nil
	}
	tokens := make([]string, 0, len(ctx))
	for k, v := range ctx {
		if v == "" {
			continue
		}
		tokens = append(tokens, canonValue(k)+"="+canonValue(v))
	}
	sort.Strings(tokens)
	return tokens
}

func canonValue(s string) string {
	stripped := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	return strings.ToLower(strings.TrimSpace(stripped))
}

// --- 減衰つき事後分布 (本体 internal/core/beta.go) ---

func decayFactor(fromMs, toMs int64) float64 {
	if toMs <= fromMs {
		return 1
	}
	return math.Exp2(-float64(toMs-fromMs) / float64(halfLifeMs))
}

func connPrior(c Connection) (a, b float64) {
	if c.PriorAlpha <= 0 || c.PriorBeta <= 0 {
		return priorAlpha, priorBeta
	}
	return c.PriorAlpha, c.PriorBeta
}

func posteriorAt(c Connection, nowMs int64) (a, b float64) {
	pa, pb := connPrior(c)
	f := decayFactor(c.LastUpdate, nowMs)
	return pa + (c.Alpha-pa)*f, pb + (c.Beta-pb)*f
}

func connEvidence(c Connection, nowMs int64) float64 {
	pa, pb := connPrior(c)
	a, b := posteriorAt(c, nowMs)
	return a + b - pa - pb
}

// --- Beta 分布の数値計算 (本体 internal/core/betamath.go) ---

func lnBeta(a, b float64) float64 {
	la, _ := math.Lgamma(a)
	lb, _ := math.Lgamma(b)
	lab, _ := math.Lgamma(a + b)
	return la + lb - lab
}

func regIncBeta(x, a, b float64) float64 {
	if x <= 0 {
		return 0
	}
	if x >= 1 {
		return 1
	}
	front := math.Exp(a*math.Log(x) + b*math.Log(1-x) - lnBeta(a, b))
	if x <= (a+1)/(a+b+2) {
		return front * betaCF(x, a, b) / a
	}
	return 1 - regIncBeta(1-x, b, a)
}

func betaCF(x, a, b float64) float64 {
	const (
		maxIter = 300
		eps     = 1e-14
		tiny    = 1e-300
	)
	qab, qap, qam := a+b, a+1, a-1
	c := 1.0
	d := 1 - qab*x/qap
	if math.Abs(d) < tiny {
		d = tiny
	}
	d = 1 / d
	h := d
	for m := 1; m <= maxIter; m++ {
		m2 := float64(2 * m)
		aa := float64(m) * (b - float64(m)) * x / ((qam + m2) * (a + m2))
		d = 1 + aa*d
		if math.Abs(d) < tiny {
			d = tiny
		}
		c = 1 + aa/c
		if math.Abs(c) < tiny {
			c = tiny
		}
		d = 1 / d
		h *= d * c
		aa = -(a + float64(m)) * (qab + float64(m)) * x / ((a + m2) * (qap + m2))
		d = 1 + aa*d
		if math.Abs(d) < tiny {
			d = tiny
		}
		c = 1 + aa/c
		if math.Abs(c) < tiny {
			c = tiny
		}
		d = 1 / d
		del := d * c
		h *= del
		if math.Abs(del-1) < eps {
			break
		}
	}
	return h
}

func betaQuantile(a, b, q float64) float64 {
	if q <= 0 {
		return 0
	}
	if q >= 1 {
		return 1
	}
	lo, hi := 0.0, 1.0
	for i := 0; i < 80; i++ {
		mid := (lo + hi) / 2
		if regIncBeta(mid, a, b) < q {
			lo = mid
		} else {
			hi = mid
		}
	}
	return (lo + hi) / 2
}

func sampleBeta(rng *rand.Rand, a, b float64) float64 {
	x := sampleGamma(rng, a)
	y := sampleGamma(rng, b)
	if x+y == 0 {
		return 0.5
	}
	return x / (x + y)
}

func sampleGamma(rng *rand.Rand, shape float64) float64 {
	if shape < 1 {
		u := 1 - rng.Float64()
		return sampleGamma(rng, shape+1) * math.Pow(u, 1/shape)
	}
	d := shape - 1.0/3
	c := 1 / math.Sqrt(9*d)
	for {
		x := rng.NormFloat64()
		v := 1 + c*x
		if v <= 0 {
			continue
		}
		v = v * v * v
		u := 1 - rng.Float64()
		if u < 1-0.0331*x*x*x*x {
			return d * v
		}
		if math.Log(u) < 0.5*x*x+d*(1-v+math.Log(v)) {
			return d * v
		}
	}
}

func quantileAt(c Connection, nowMs int64, q float64) float64 {
	a, b := posteriorAt(c, nowMs)
	return betaQuantile(a, b, q)
}

func sampleAt(c Connection, rng *rand.Rand, nowMs int64) float64 {
	a, b := posteriorAt(c, nowMs)
	return sampleBeta(rng, a, b)
}

// --- スコープ (本体 internal/core/scope.go) ---

func parseScopeKey(key string) []string {
	if key == "" {
		return []string{}
	}
	parts := strings.Split(key, "|")
	seen := make(map[string]bool, len(parts))
	out := make([]string, 0, len(parts))
	for _, t := range parts {
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

func subsetOf(scope, tokens []string) bool {
	set := make(map[string]bool, len(tokens))
	for _, t := range tokens {
		set[t] = true
	}
	for _, t := range scope {
		if !set[t] {
			return false
		}
	}
	return true
}

// --- 判断エンジン (本体 internal/decide/decide.go — Wobble が要る分だけ) ---

func finestMatch(conns []Connection, kind, target string, tokens []string) *Connection {
	var best *Connection
	bestLen := -1
	for i := range conns {
		c := &conns[i]
		if c.Kind != kind || c.Target != target {
			continue
		}
		scope := parseScopeKey(c.ScopeKey)
		if !subsetOf(scope, tokens) {
			continue
		}
		if len(scope) > bestLen || (len(scope) == bestLen && c.ScopeKey < best.ScopeKey) {
			best, bestLen = c, len(scope)
		}
	}
	return best
}

func firstWins(rng *rand.Rand, conns []Connection, tokens []string, a, b string, n int, nowMs int64) bool {
	target := a + "~" + b
	c := finestMatch(conns, "preference", target, tokens)
	sum := 0.0
	for i := 0; i < n; i++ {
		if c != nil {
			sum += sampleAt(*c, rng, nowMs)
		} else {
			sum += sampleBeta(rng, priorAlpha, priorBeta)
		}
	}
	return sum/float64(n) >= 0.5
}

// chooseProvider は本体 decide.Choose の勝者だけを返す移植:
// 悲観分位ゲート → 合格者のペアワイズ Thompson トーナメント。
func chooseProvider(conns []Connection, providers, tokens []string, seed, nowMs int64) string {
	sorted := append([]string(nil), providers...)
	sort.Strings(sorted)

	type candidate struct {
		provider string
		quantile float64
		passed   bool
		wins     int
	}
	const draws = 1 // stakes 属性なしの n(size="") — Wobble からの呼び出しはこれのみ

	cands := make([]candidate, 0, len(sorted))
	var passers []int
	for _, p := range sorted {
		cand := candidate{provider: p, quantile: blankQuantile}
		if c := finestMatch(conns, "capability", p, tokens); c != nil {
			cand.quantile = quantileAt(*c, nowMs, quantileQ)
		}
		cand.passed = cand.quantile >= quantileQ-gateMargin
		if cand.passed {
			passers = append(passers, len(cands))
		}
		cands = append(cands, cand)
	}

	if len(passers) == 0 {
		best := 0
		for i := 1; i < len(cands); i++ {
			if cands[i].quantile > cands[best].quantile {
				best = i
			}
		}
		return cands[best].provider
	}

	rng := rand.New(rand.NewSource(seed))
	for i := 0; i < len(passers); i++ {
		for j := i + 1; j < len(passers); j++ {
			a, b := &cands[passers[i]], &cands[passers[j]]
			if firstWins(rng, conns, tokens, a.provider, b.provider, draws, nowMs) {
				a.wins++
			} else {
				b.wins++
			}
		}
	}

	best := passers[0]
	for _, i := range passers[1:] {
		c, b := cands[i], cands[best]
		if c.wins > b.wins || (c.wins == b.wins && c.quantile > b.quantile) {
			best = i
		}
	}
	return cands[best].provider
}

func wobble(conns []Connection, providers, tokens []string, m int, seed, nowMs int64) float64 {
	if m <= 0 || len(providers) == 0 {
		return 0
	}
	counts := map[string]int{}
	for i := 0; i < m; i++ {
		counts[chooseProvider(conns, providers, tokens, seed+int64(i), nowMs)]++
	}
	max := 0
	for _, n := range counts {
		if n > max {
			max = n
		}
	}
	return 1 - float64(max)/float64(m)
}

// --- ステージ関数 (本体 internal/face/stage.go) ---

func stageFrom(conns []Connection, ledger []ledgerEntry, exps []stageExperience, nowMs int64) int {
	if len(conns) == 0 {
		return 0 // 毛玉
	}

	maxEvidence := 0.0
	maxPreferenceEvidence := 0.0
	for _, c := range conns {
		if ev := connEvidence(c, nowMs); ev > maxEvidence {
			maxEvidence = ev
		}
		if c.Kind == "preference" {
			if ev := connEvidence(c, nowMs); ev > maxPreferenceEvidence {
				maxPreferenceEvidence = ev
			}
		}
	}
	if maxEvidence < 3 {
		return 1 // あかちゃん
	}

	if !isCalibrated(ledger, nowMs) {
		return 2 // こども
	}

	if !isSharp(conns, exps, nowMs) {
		return 3 // わかもの
	}

	if maxPreferenceEvidence >= 1.0 {
		return 5 // あいぼう
	}
	return 4 // おとな
}

func isCalibrated(ledger []ledgerEntry, nowMs int64) bool {
	var sumWS, sumW float64
	for _, e := range ledger {
		w := decayFactor(e.TS, nowMs)
		sumWS += w * e.SExcess
		sumW += w
	}
	if sumW <= 0 {
		return false
	}
	return sumWS/sumW <= thetaCal
}

func isSharp(conns []Connection, exps []stageExperience, nowMs int64) bool {
	providerSet := map[string]bool{}
	islandSet := map[string]bool{}
	for _, c := range conns {
		if c.Kind != "capability" {
			continue
		}
		providerSet[c.Target] = true
		islandSet[c.ScopeKey] = true
	}
	providers := make([]string, 0, len(providerSet))
	for p := range providerSet {
		providers = append(providers, p)
	}

	frequent := 0
	for key := range islandSet {
		scope := parseScopeKey(key)
		freq := 0.0
		for _, e := range exps {
			if e.Kind == "execution" && subsetOf(scope, e.Tokens) {
				freq += decayFactor(e.TS, nowMs)
			}
		}
		if freq < islandMinFreq {
			continue
		}
		frequent++
		if wobble(conns, providers, scope, sharpDraws, stageSeed, nowMs) > thetaSharp {
			return false
		}
	}
	return frequent > 0
}
