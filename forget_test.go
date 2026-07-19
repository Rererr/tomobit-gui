package main

import (
	"fmt"
	"reflect"
	"testing"
)

// captureRunner swaps runTomobit for one test: 記録した引数列を返しつつ、
// 指定の streams / error を演じる。
func captureRunner(t *testing.T, stdout, stderr string, err error) *[][]string {
	t.Helper()
	var calls [][]string
	orig := runTomobit
	runTomobit = func(args ...string) (string, string, error) {
		calls = append(calls, args)
		return stdout, stderr, err
	}
	t.Cleanup(func() { runTomobit = orig })
	return &calls
}

func TestForgetExperiences_繰り返しのidと必須のyesでCLIを呼ぶ(t *testing.T) {
	calls := captureRunner(t, "forgot: 2 experiences (rebuilt: 3 connections)\n", "", nil)
	res, err := NewApp().ForgetExperiences([]string{"exp-a", "exp-b"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"forget", "--id", "exp-a", "--id", "exp-b", "--yes"}
	if len(*calls) != 1 || !reflect.DeepEqual((*calls)[0], want) {
		t.Fatalf("CLI引数が契約と違う: %v", *calls)
	}
	if res.Summary != "forgot: 2 experiences (rebuilt: 3 connections)" {
		t.Fatalf("stdoutの1行サマリがそのまま返らない: %q", res.Summary)
	}
}

func TestForgetExperiences_対象なしと空idはCLIを呼ばずにエラー(t *testing.T) {
	calls := captureRunner(t, "", "", nil)
	if _, err := NewApp().ForgetExperiences(nil); err == nil {
		t.Fatal("空の対象がエラーにならない")
	}
	if _, err := NewApp().ForgetExperiences([]string{"exp-a", " "}); err == nil {
		t.Fatal("空白のidがエラーにならない")
	}
	if len(*calls) != 0 {
		t.Fatalf("不正入力でCLIが呼ばれた: %v", *calls)
	}
}

func TestForgetExperiences_失敗はstderrの文言で伝わる(t *testing.T) {
	captureRunner(t, "", "error: forget: no such experience \"x\"\n", fmt.Errorf("exit status 1"))
	_, err := NewApp().ForgetExperiences([]string{"x"})
	if err == nil || err.Error() != `error: forget: no such experience "x"` {
		t.Fatalf("stderrの文言が届かない: %v", err)
	}
}

func TestForgetExperiences_サマリ後の失敗は完了分を握り潰さない(t *testing.T) {
	// ADR-0033 Decision 5: VACUUM失敗は論理削除+rebuildのcommit後 —
	// エラーに「済んだ事実」を併記する。
	captureRunner(t, "forgot: 1 experiences (rebuilt: 2 connections)\n",
		"error: vacuum failed\n", fmt.Errorf("exit status 1"))
	_, err := NewApp().ForgetExperiences([]string{"exp-a"})
	if err == nil {
		t.Fatal("エラーが返らない")
	}
	msg := err.Error()
	if msg != "error: vacuum failed（完了済み: forgot: 1 experiences (rebuilt: 2 connections)）" {
		t.Fatalf("完了済みサマリが併記されない: %q", msg)
	}
}

func TestAmendExperience_編集した項目のフラグだけを渡す(t *testing.T) {
	calls := captureRunner(t, "amended: exp-a -> ver 2 (rebuilt: 3 connections)\n", "", nil)
	res, err := NewApp().AmendExperience(AmendRequest{
		ID: "exp-a", SetContext: true, Context: `{"topic":"testing"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"amend", "--id", "exp-a", "--context", `{"topic":"testing"}`}
	if len(*calls) != 1 || !reflect.DeepEqual((*calls)[0], want) {
		t.Fatalf("未編集の項目までCLIへ渡っている: %v", *calls)
	}
	if res.Summary != "amended: exp-a -> ver 2 (rebuilt: 3 connections)" {
		t.Fatalf("サマリが返らない: %q", res.Summary)
	}
}

func TestAmendExperience_全項目編集は3フラグとも渡す(t *testing.T) {
	calls := captureRunner(t, "amended\n", "", nil)
	_, err := NewApp().AmendExperience(AmendRequest{
		ID: "exp-a", SetContext: true, Context: `{}`,
		SetOutcome: true, Outcome: `{"verdict":"up"}`,
		SetProvider: true, Provider: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"amend", "--id", "exp-a", "--context", `{}`,
		"--outcome", `{"verdict":"up"}`, "--provider", "human"}
	if !reflect.DeepEqual((*calls)[0], want) {
		t.Fatalf("CLI引数が契約と違う: %v", *calls)
	}
}

func TestAmendExperience_変更なしとid欠落はCLIを呼ばずにエラー(t *testing.T) {
	calls := captureRunner(t, "", "", nil)
	if _, err := NewApp().AmendExperience(AmendRequest{ID: "exp-a"}); err == nil {
		t.Fatal("変更なしがエラーにならない")
	}
	if _, err := NewApp().AmendExperience(AmendRequest{SetOutcome: true, Outcome: "{}"}); err == nil {
		t.Fatal("id欠落がエラーにならない")
	}
	if len(*calls) != 0 {
		t.Fatalf("不正入力でCLIが呼ばれた: %v", *calls)
	}
}
