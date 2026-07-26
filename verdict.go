// 第2層の口 (本体 ADR-0055): 過去セッションへの 👍/👎 を `tomobit verdict` の
// サブプロセス実行で呼ぶ。forget/amend と同じ姿勢で、GUIはDBに書かない —
// 読みは mode=ro (memory.go)、書きは本体の動詞だけである。
//
// **誰を判定できるかを GUI は判定しない。** 本体は中断・未終了・分割の子・
// amend済みの4つを断るが、その規則をここに写すと本体とドリフトする
// (forget.go が context key / provider名 について書いたのと同じ理由)。ボタンは
// 常に出し、断られたら本体の文言をそのまま見せる — あちらの拒否メッセージは
// 「親の <sid> を判定する」「amend --outcome を使う」まで書いてあるので、
// 写して薄めるより届く。
package main

import (
	"fmt"
	"strings"
)

// verdictWords mirrors the body's closed vocabulary only to catch a typo before
// spawning a process. It is not the gate — the body is (see the package doc).
var verdictWords = map[string]bool{"up": true, "down": true, "clear": true}

// SetVerdict records the human's layer-2 judgment on a past session
// (本体 ADR-0055 Decision 2)。"clear" は取り消しで、判定を外して第1層へ戻す。
func (a *App) SetVerdict(sessionID, verdict string) (WriteResult, error) {
	sid := strings.TrimSpace(sessionID)
	if sid == "" {
		return WriteResult{}, fmt.Errorf("verdict: セッションidが無い")
	}
	if !verdictWords[verdict] {
		return WriteResult{}, fmt.Errorf("verdict: 判定は up / down / clear のいずれか（%q）", verdict)
	}
	return runWriteVerb([]string{"verdict", sid, verdict})
}
