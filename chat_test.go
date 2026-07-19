package main

import (
	"errors"
	"strings"
	"sync"
	"testing"
)

func TestFlattenTurnLine_改行は1ターンの枠内でスペースになる(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"1行はそのまま", "こんにちは", "こんにちは"},
		{"LFはスペース", "a\nb", "a b"},
		{"CRLFもスペース1つ", "a\r\nb", "a b"},
		{"裸のCRもスペース", "a\rb", "a b"},
		{"連続改行は行数ぶんのスペース", "a\n\nb", "a  b"},
		{"空文字列は空のまま", "", ""},
	}
	for _, c := range cases {
		if got := flattenTurnLine(c.in); got != c.want {
			t.Errorf("%s: flattenTurnLine(%q) = %q, want %q", c.name, c.in, got, c.want)
		}
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
