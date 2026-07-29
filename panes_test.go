package main

import (
	"context"
	"path/filepath"
	"testing"
)

// 旧構成（panes キー無し）は1窓へ写る。既存の gui.json が黙って空の画面に
// なることは無い、という移行の一点 (ADR-0009 Decision 3)。
func TestPaneListMigratesALegacyConfig(t *testing.T) {
	c := GUIConfig{WorkingDir: "/repo", ReadDirs: []string{"/extra", "", "/extra"}}

	panes := c.PaneList()
	if len(panes) != 1 {
		t.Fatalf("旧構成は1窓へ写る: %+v", panes)
	}
	if panes[0].ID != mainPane || panes[0].WorkingDir != "/repo" {
		t.Errorf("旧来の働く場所を引き継ぐ: %+v", panes[0])
	}
	// 正規化の規則は窓にも同じものが効く（正本は1つ）。
	if got := panes[0].NormalizedReadDirs(); len(got) != 1 || got[0] != "/extra" {
		t.Errorf("読み取り先の重複と空白は落ちる: %v", got)
	}
}

func TestPaneListNeverReturnsNothing(t *testing.T) {
	// 会話面が0個の GUI はただ壊れて見える。何も設定されていない機械でも1窓。
	if panes := (GUIConfig{}).PaneList(); len(panes) != 1 {
		t.Errorf("空の設定でも1窓は返る: %+v", panes)
	}
}

func TestPaneListIsCappedByTheScreen(t *testing.T) {
	many := make([]PaneConfig, MaxPanes+3)
	for i := range many {
		many[i] = PaneConfig{ID: string(rune('a' + i))}
	}
	if got := (GUIConfig{Panes: many}).PaneList(); len(got) != MaxPanes {
		t.Errorf("画面の物理を超える窓は開かない: %d", len(got))
	}
}

// 未知の id で起動を止めない: 窓の構成と走っているプロセスは一瞬ずれうる
// （窓を閉じた直後の在庫イベント等）。そこで失敗させると、直前まで使えていた
// 窓が黙って死ぬ。
func TestPaneForFallsBackRatherThanFailing(t *testing.T) {
	c := GUIConfig{Panes: []PaneConfig{{ID: "a", WorkingDir: "/a"}, {ID: "b", WorkingDir: "/b"}}}

	if got := c.PaneFor("b").WorkingDir; got != "/b" {
		t.Errorf("既知の id は自分の場所を返す: %q", got)
	}
	if got := c.PaneFor("gone").WorkingDir; got != "/a" {
		t.Errorf("未知の id は先頭へ落ちる: %q", got)
	}
}

func TestAddPaneStopsAtTheScreensLimit(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	a := NewApp()

	for i := 1; i < MaxPanes; i++ {
		panes, err := a.AddPane()
		if err != nil {
			t.Fatalf("窓 %d の追加: %v", i+1, err)
		}
		// 1つの構成の中で id が重なってはいけない — 重なれば2つの窓が1つの
		// chat プロセスを共有し、片方の会話がもう片方の画面に流れ込む。
		seen := map[string]bool{}
		for _, p := range panes {
			if seen[p.ID] {
				t.Fatalf("id が衝突した: %s (%+v)", p.ID, panes)
			}
			seen[p.ID] = true
		}
	}
	if _, err := a.AddPane(); err == nil {
		t.Errorf("%d個を超えて開けてしまう", MaxPanes)
	}
}

// 新しい窓は「まだどこでも働いていない」状態で生まれる。直前の窓の場所を継ぐと、
// 同じ場所で2つ動く構成が既定になる — Decision 6 が事実として言う羽目になる状態を、
// 既定で作りに行かない。
func TestAddPaneDoesNotInheritTheOtherWindowsPlace(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	a := NewApp()
	work := t.TempDir()
	if _, err := a.SetWorkspace(mainPane, work, nil); err != nil {
		t.Fatal(err)
	}

	panes, err := a.AddPane()
	if err != nil {
		t.Fatal(err)
	}
	if len(panes) != 2 {
		t.Fatalf("2窓になる: %+v", panes)
	}
	if panes[1].WorkingDir != "" {
		t.Errorf("新しい窓は場所を継がない: %+v", panes[1])
	}
	if panes[0].WorkingDir != work {
		t.Errorf("元の窓の場所は残る: %+v", panes[0])
	}
}

func TestClosePaneKeepsTheLastWindow(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	a := NewApp()

	if _, err := a.ClosePane(mainPane); err == nil {
		t.Errorf("最後の窓は閉じられない")
	}

	if _, err := a.AddPane(); err != nil {
		t.Fatal(err)
	}
	// プロセスが無ければ締める相手も居ないので false（EndTask と同じ意味論）。
	started, err := a.ClosePane("pane-2")
	if err != nil {
		t.Fatalf("ClosePane: %v", err)
	}
	if started {
		t.Errorf("走っていない窓の締めは始まらない")
	}
	panes, err := a.GetPanes()
	if err != nil {
		t.Fatal(err)
	}
	if len(panes) != 1 || panes[0].ID != mainPane {
		t.Errorf("閉じた窓は残らない: %+v", panes)
	}
}

// 画面の下限は窓の数で決まる。1窓ぶんの 640x480 のまま2列に割ると入力欄が
// 潰れ、2行に割ると作業バーが2行になった窓の入力欄が clip される（実測）。
func TestPaneMinSizeFollowsTheGrid(t *testing.T) {
	for _, tc := range []struct {
		panes         int
		width, height int
		why           string
	}{
		{1, 640, 480, "1窓の下限は据え置き（サイドバー+チャット面の実用幅）"},
		{2, 960, 480, "2列は横に足りない"},
		{3, 960, 620, "2行は縦に足りない"},
		{4, 960, 620, "3窓と4窓は同じ格子"},
	} {
		w, h := paneMinSize(tc.panes)
		if w != tc.width || h != tc.height {
			t.Errorf("paneMinSize(%d) = %dx%d, want %dx%d — %s", tc.panes, w, h, tc.width, tc.height, tc.why)
		}
	}
}

// 窓を増やせば下限も上がり、閉じれば戻る。設定だけ書き換えて画面の下限を
// 据え置くと、増えた窓がその場で潰れる。
func TestAddAndClosePaneMoveTheWindowFloor(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	a := NewApp()
	type size struct{ width, height int }
	var applied []size
	a.setMinSize = func(width, height int) { applied = append(applied, size{width, height}) }
	last := func() size {
		t.Helper()
		if len(applied) == 0 {
			t.Fatal("窓の並びが変わったのに下限を引き直していない")
		}
		return applied[len(applied)-1]
	}

	if _, err := a.AddPane(); err != nil {
		t.Fatal(err)
	}
	if got := last(); got != (size{960, 480}) {
		t.Errorf("2窓の下限 = %+v, want 960x480", got)
	}
	if _, err := a.AddPane(); err != nil {
		t.Fatal(err)
	}
	if got := last(); got != (size{960, 620}) {
		t.Errorf("3窓の下限 = %+v, want 960x620", got)
	}
	if _, err := a.ClosePane("pane-3"); err != nil {
		t.Fatal(err)
	}
	if got := last(); got != (size{960, 480}) {
		t.Errorf("2窓へ戻った後の下限 = %+v, want 960x480", got)
	}
}

// 窓の並びは次回起動で復元される (ADR-0009 Decision 3)。下限だけ1窓ぶんのまま
// 開くと、復元された2列がその瞬間から潰れている。
func TestStartupAppliesTheSavedLayoutsFloor(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	a := NewApp()
	a.emit = func(string, ...interface{}) {}
	a.quit = func() {}
	var applied [2]int
	a.setMinSize = func(width, height int) { applied = [2]int{width, height} }
	if _, err := a.AddPane(); err != nil {
		t.Fatal(err)
	}

	applied = [2]int{}
	a.startup(context.Background())

	if applied != [2]int{960, 480} {
		t.Errorf("2窓で保存された gui.json から起動した下限 = %v, want [960 480]", applied)
	}
}

// 窓ごとの働く場所が、その窓の子プロセスの argv に乗る (ADR-0009 Decision 3)。
func TestEachPaneLaunchesInItsOwnPlace(t *testing.T) {
	a := &App{guiConfig: GUIConfig{
		Provider: "claude-code",
		Panes: []PaneConfig{
			{ID: "a", WorkingDir: "/repo-a", ReadDirs: []string{"/x"}},
			{ID: "b", WorkingDir: "/repo-b"},
		},
	}}

	for _, tc := range []struct{ pane, want string }{{"a", "/repo-a"}, {"b", "/repo-b"}} {
		pc := a.guiConfig.PaneFor(tc.pane)
		cmd := a.newChatCmd(filepath.Join("/usr", "bin", "tomobit"), pc.WorkingDir, pc.NormalizedReadDirs())
		if !hasFlagValue(cmd.Args, "--cd", tc.want) {
			t.Errorf("窓 %s は %s で立つ: %v", tc.pane, tc.want, cmd.Args)
		}
	}
}
