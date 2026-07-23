package main

import (
	"errors"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// decodeCooked mirrors 本体 lineedit readCooked: 末尾 `\` の行はその `\` を1つ剥いで
// `\n` を挿み次行へ続く。encodeTurn の往復先として、ワイヤ形式が意図どおりの
// ターンへ復元されることを確かめる（本体は import できないので同じ意味論を写す）。
func decodeCooked(wire string) string {
	lines := strings.Split(wire, "\n")
	// 末尾の空要素は「最後の改行」であって行ではない。
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	var acc strings.Builder
	for _, line := range lines {
		if strings.HasSuffix(line, "\\") {
			acc.WriteString(line[:len(line)-1])
			acc.WriteByte('\n')
			continue
		}
		acc.WriteString(line)
		break
	}
	return acc.String()
}

func TestEncodeTurn_末尾バックスラッシュ継続で改行を保つ(t *testing.T) {
	cases := []struct{ name, in, wantWire, wantTurn string }{
		{"単一行は素通し", "こんにちは", "こんにちは\n", "こんにちは"},
		{"LFは継続化", "a\nb", "a\\\nb\n", "a\nb"},
		{"CRLFも継続化", "a\r\nb", "a\\\nb\n", "a\nb"},
		{"裸のCRも継続化", "a\rb", "a\\\nb\n", "a\nb"},
		{"連続改行は空行を挟む", "a\n\nb", "a\\\n\\\nb\n", "a\n\nb"},
		{"中間行の末尾バックスラッシュは保存", "仕様は\\\n- A", "仕様は\\\\\n- A\n", "仕様は\\\n- A"},
		{"最終行末尾バックスラッシュはエスケープ＋空行閉じ", "末尾\\", "末尾\\\\\n\n", "末尾\\\n"},
		{"空文字列は素の空行", "", "\n", ""},
	}
	for _, c := range cases {
		gotWire := encodeTurn(c.in)
		if gotWire != c.wantWire {
			t.Errorf("%s: encodeTurn(%q) = %q, want wire %q", c.name, c.in, gotWire, c.wantWire)
		}
		if gotTurn := decodeCooked(gotWire); gotTurn != c.wantTurn {
			t.Errorf("%s: readCooked往復 = %q, want turn %q", c.name, gotTurn, c.wantTurn)
		}
	}
}

func TestComposeChatEnv_顔窓オプトインと喋り方を積む(t *testing.T) {
	has := func(env []string, kv string) bool {
		for _, e := range env {
			if e == kv {
				return true
			}
		}
		return false
	}
	hasKey := func(env []string, key string) bool {
		for _, e := range env {
			if strings.HasPrefix(e, key+"=") {
				return true
			}
		}
		return false
	}

	// TOMOBIT_FACE 未設定 + GUI設定ON（既定） → =1 が付く（この pipe の先に人が居る宣言）。
	if env := composeChatEnv([]string{"PATH=/usr/bin"}, "", false, "", true); !has(env, "TOMOBIT_FACE=1") {
		t.Errorf("未設定・ON なのに TOMOBIT_FACE=1 が立たない: %v", env)
	}

	// 既設定（0 でも 1 でも）は GUI設定に関わらず触らない — ユーザーの明示を GUI が覆さない。
	for _, val := range []string{"0", "1"} {
		for _, faceEnabled := range []bool{true, false} {
			base := []string{"PATH=/usr/bin", "TOMOBIT_FACE=" + val}
			env := composeChatEnv(base, "", true, "", faceEnabled)
			if !has(env, "TOMOBIT_FACE="+val) {
				t.Errorf("既設定 =%s（faceEnabled=%v） が消えた: %v", val, faceEnabled, env)
			}
			if val == "0" && has(env, "TOMOBIT_FACE=1") {
				t.Errorf("既設定 =0（faceEnabled=%v） を GUI が =1 で上書きした: %v", faceEnabled, env)
			}
		}
	}

	// TOMOBIT_FACE 未設定 + GUI設定OFF → 何も書かない沈黙のまま
	// （`=0` は書かない — pipe では沈黙=開かないため、OFFの意思は沈黙で表す）。
	if env := composeChatEnv([]string{"PATH=/usr/bin"}, "", false, "", false); hasKey(env, "TOMOBIT_FACE") {
		t.Errorf("未設定・OFF なのに TOMOBIT_FACE が書かれた: %v", env)
	}

	// 喋り方併用時は喋り方の注入と顔窓オプトインが両方入る（直積）。
	env := composeChatEnv([]string{"PATH=/usr/bin"}, "関西弁で", false, "", true)
	if !has(env, `TOMOBIT_CLAUDE_ARGS_APPEND=--append-system-prompt "関西弁で"`) {
		t.Errorf("喋り方が注入されない: %v", env)
	}
	if !has(env, "TOMOBIT_FACE=1") {
		t.Errorf("喋り方併用で顔窓オプトインが消えた: %v", env)
	}
}

func TestChatEnv_App配線がguiConfigとos環境をcomposeChatEnvへ正しく渡す(t *testing.T) {
	hasKey := func(env []string, key string) bool {
		for _, e := range env {
			if strings.HasPrefix(e, key+"=") {
				return true
			}
		}
		return false
	}
	has := func(env []string, kv string) bool {
		for _, e := range env {
			if e == kv {
				return true
			}
		}
		return false
	}

	// TOMOBIT_FACE 未設定 + guiConfig 明示 OFF → chatEnv() 経由でも沈黙のまま
	// （ensureProcLocked の cmd.Env 配線一行がここでしか踏まれない — composeChatEnv
	// 自体のテストは os.Environ()/a.guiConfig を経由しない）。
	t.Setenv("TOMOBIT_CLAUDE_ARGS_APPEND", "")
	// t.Setenv は元値の復元を登録するためだけに呼び、直後に消す（face_e2e_test.go と同じ手筋）。
	if v, ok := os.LookupEnv("TOMOBIT_FACE"); ok {
		t.Setenv("TOMOBIT_FACE", v)
		os.Unsetenv("TOMOBIT_FACE")
	}
	off := false
	a := &App{guiConfig: GUIConfig{FaceEnabled: &off}}
	if env := a.chatEnv(); hasKey(env, "TOMOBIT_FACE") {
		t.Errorf("guiConfig で OFF なのに TOMOBIT_FACE が書かれた: %v", env)
	}

	// TOMOBIT_FACE 未設定 + guiConfig 明示 ON + 喋り方あり → 両方 chatEnv() に乗る。
	on := true
	a = &App{guiConfig: GUIConfig{SpeakingStyle: "関西弁で", FaceEnabled: &on}}
	env := a.chatEnv()
	if !has(env, "TOMOBIT_FACE=1") {
		t.Errorf("guiConfig で ON なのに TOMOBIT_FACE=1 が chatEnv() に無い: %v", env)
	}
	if !has(env, `TOMOBIT_CLAUDE_ARGS_APPEND=--append-system-prompt "関西弁で"`) {
		t.Errorf("guiConfig の喋り方が chatEnv() に無い: %v", env)
	}

	// 親プロセスが TOMOBIT_FACE を明示していれば guiConfig の ON/OFF に関わらず触らない。
	t.Setenv("TOMOBIT_FACE", "0")
	a = &App{guiConfig: GUIConfig{FaceEnabled: &on}}
	if env := a.chatEnv(); !has(env, "TOMOBIT_FACE=0") {
		t.Errorf("親の明示 TOMOBIT_FACE=0 が chatEnv() で消えた: %v", env)
	}
}

func TestUTF8CompletePrefix_末尾の不完全なルーンだけを持ち越す(t *testing.T) {
	a3 := []byte("あ") // 3 bytes
	cases := []struct {
		name string
		in   []byte
		want int
	}{
		{"ASCIIは全部", []byte("hello"), 5},
		{"完全なマルチバイトは全部", []byte("aあ"), 4},
		{"3バイト文字の先頭2バイトは持ち越し", a3[:2], 0},
		{"直前まで完全＋切れ端", append([]byte("あ"), a3[:1]...), 3},
		{"単独の不正バイトは素通し", []byte{0xFF}, 1},
		{"継続バイトだけの列は素通し", []byte{0x80, 0x80, 0x80, 0x80}, 4},
		{"空は0", nil, 0},
	}
	for _, c := range cases {
		if got := utf8CompletePrefix(c.in); got != c.want {
			t.Errorf("%s: utf8CompletePrefix(% x) = %d, want %d", c.name, c.in, got, c.want)
		}
	}
}

// chunkReader yields each given chunk for one Read call, then EOF — a pipe
// whose delivery boundaries the test controls.
type chunkReader struct{ chunks [][]byte }

func (r *chunkReader) Read(p []byte) (int, error) {
	if len(r.chunks) == 0 {
		return 0, errors.New("EOF")
	}
	n := copy(p, r.chunks[0])
	r.chunks = r.chunks[1:]
	return n, nil
}

func TestPumpStream_ルーン分断は結合され全文が欠けず届く(t *testing.T) {
	raw := []byte("答えは「4219」です")
	var mu sync.Mutex
	var got []string
	app := NewApp()
	app.emit = func(name string, data ...interface{}) {
		if name != eventChatOut {
			t.Fatalf("unexpected event %q", name)
		}
		mu.Lock()
		defer mu.Unlock()
		chunk := data[0].(OutChunk)
		if chunk.Channel != "stdout" {
			t.Errorf("channel = %q, want stdout", chunk.Channel)
		}
		got = append(got, chunk.Text)
	}
	// 「答」(3 bytes) を2バイト目で割るチャンク境界。
	r := &chunkReader{chunks: [][]byte{raw[:5], raw[5:]}}
	app.pumpStream(r, "stdout")

	joined := strings.Join(got, "")
	if joined != string(raw) {
		t.Fatalf("stream reassembled = %q, want %q", joined, raw)
	}
	for i, c := range got {
		if !strings.Contains(string(raw), c) {
			t.Errorf("chunk %d %q is not a clean substring — rune was split", i, c)
		}
	}
}

func TestPumpViewStream_stdoutをNDJSONイベント列にフレーミングする(t *testing.T) {
	cases := []struct {
		name   string
		chunks [][]byte
		want   []map[string]any
	}{
		{
			"行の途中で切れても1イベントに復元",
			[][]byte{[]byte(`{"type":"te`), []byte("xt\",\"text\":\"2\"}\n")},
			[]map[string]any{{"type": "text", "text": "2"}},
		},
		{
			"1チャンクの複数行は行ごとにemit",
			[][]byte{[]byte("{\"type\":\"turn.started\",\"n\":1}\n{\"type\":\"text\",\"text\":\"a\"}\n")},
			[]map[string]any{
				{"type": "turn.started", "n": float64(1)},
				{"type": "text", "text": "a"},
			},
		},
		{
			"非JSON行はnoteにフォールバック",
			[][]byte{[]byte("これはJSONではない\n")},
			[]map[string]any{{"type": "note", "text": "これはJSONではない"}},
		},
		{
			"EOF時の持ち越しも処理される",
			[][]byte{[]byte(`{"type":"ready"}`)},
			[]map[string]any{{"type": "ready"}},
		},
		{
			"未知typeもGoは解釈せず素通しする",
			[][]byte{[]byte("{\"type\":\"mystery\",\"foo\":\"bar\"}\n")},
			[]map[string]any{{"type": "mystery", "foo": "bar"}},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var mu sync.Mutex
			var got []map[string]any
			app := NewApp()
			app.emit = func(name string, data ...interface{}) {
				if name != eventChatView {
					t.Errorf("event name = %q, want %q", name, eventChatView)
				}
				mu.Lock()
				defer mu.Unlock()
				got = append(got, data[0].(map[string]any))
			}
			app.pumpViewStream(&chunkReader{chunks: append([][]byte(nil), c.chunks...)}, nil)
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("events = %#v, want %#v", got, c.want)
			}
		})
	}
}

func TestEscapeAppendSystemPrompt_バックスラッシュと二重引用符だけをエスケープ(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"素のテキストはダブルクォートで包むだけ", "関西弁で", `"関西弁で"`},
		{"二重引用符はエスケープ", `言う"こと"`, `"言う\"こと\""`},
		{"バックスラッシュはエスケープ", `C:\path`, `"C:\\path"`},
		{"空文字列も引用符だけになる", "", `""`},
		{"改行はそのまま引用符内に残す", "1行目\n2行目", "\"1行目\n2行目\""},
	}
	for _, c := range cases {
		if got := escapeAppendSystemPrompt(c.in); got != c.want {
			t.Errorf("%s: escapeAppendSystemPrompt(%q) = %q, want %q", c.name, c.in, got, c.want)
		}
	}
}

func TestComposeClaudeArgsAppend_既存の値の後ろに追記される(t *testing.T) {
	cases := []struct {
		name, existing, style, want string
	}{
		{
			"既存が空なら--append-system-promptだけ",
			"", "関西弁で",
			`--append-system-prompt "関西弁で"`,
		},
		{
			"既存があればスペース区切りで後ろに追記",
			"--exclude-dynamic-system-prompt-sections", "関西弁で",
			`--exclude-dynamic-system-prompt-sections --append-system-prompt "関西弁で"`,
		},
	}
	for _, c := range cases {
		if got := composeClaudeArgsAppend(c.existing, c.style); got != c.want {
			t.Errorf("%s: composeClaudeArgsAppend(%q, %q) = %q, want %q", c.name, c.existing, c.style, got, c.want)
		}
	}
}

func TestFindTomobit_PATHになければgoのbinへフォールバックし両方なければ意味のあるエラー(t *testing.T) {
	notFound := func(string) (string, error) { return "", errors.New("not found") }
	if _, err := findTomobit(notFound, func() (string, error) { return t.TempDir(), nil }); err == nil {
		t.Fatal("PATHにもgo/binにも無いのにエラーなし")
	} else if !strings.Contains(err.Error(), "tomobit") {
		t.Errorf("エラーが原因を語らない: %v", err)
	}
	if p, err := findTomobit(func(string) (string, error) { return "/usr/local/bin/tomobit", nil }, nil); err != nil || p != "/usr/local/bin/tomobit" {
		t.Errorf("PATH優先が効かない: %v %v", p, err)
	}
}
