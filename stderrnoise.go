package main

import "strings"

// macOS の Text Services Manager / InputMethodKit が NSLog 経由でアプリの
// stderr へ吐く既知のシステムノイズの署名。アプリ側の API では抑止できず、
// 端末から直接起動したときだけ見える（Finder 経由ならシステムログへ行く）。
var macOSStderrNoiseSignatures = []string{
	// "TSM AdjustCapsLockLEDForKeyTransitionHandling - _ISSetPhysicalKeyboardCapsLockLED Inhibit"
	"_ISSetPhysicalKeyboardCapsLockLED",
	// "error messaging the mach port for IMKCFRunLoopWakeUpReliable"
	"IMKCFRunLoopWakeUpReliable",
}

// isMacOSStderrNoise は stderr の1行が既知の macOS システムノイズかを返す。
// "error" や "TSM" のような汎用語では判定しない — 実エラーを巻き込んで
// 落とすくらいなら、未知のノイズを素通しする側に倒す。
func isMacOSStderrNoise(line string) bool {
	for _, sig := range macOSStderrNoiseSignatures {
		if strings.Contains(line, sig) {
			return true
		}
	}
	return false
}
