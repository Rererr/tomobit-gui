package main

import "testing"

// stderr 濾過のテストは What = 「観測された macOS システムノイズ2種だけを
// 落とし、それ以外の stderr は1行も奪わない」。

func TestIsMacOSStderrNoise_観測された実ログ2種をノイズと判定する(t *testing.T) {
	// 2026-07-29 に実機 (macOS / 端末起動) で観測されたログそのままを検体にする。
	observed := []string{
		"2026-07-29 04:27:45.201 tomobit-gui[47002:33070733] TSM AdjustCapsLockLEDForKeyTransitionHandling - _ISSetPhysicalKeyboardCapsLockLED Inhibit\n",
		"2026-07-29 04:27:59.792 tomobit-gui[47002:33070733] error messaging the mach port for IMKCFRunLoopWakeUpReliable\n",
	}
	for _, line := range observed {
		if !isMacOSStderrNoise(line) {
			t.Errorf("既知ノイズを素通しした: %q", line)
		}
	}
}

func TestIsMacOSStderrNoise_実エラーはノイズと判定しない(t *testing.T) {
	real := []string{
		"tomobit-gui: 起動に失敗: exit status 1\n",
		"panic: runtime error: invalid memory address or nil pointer dereference\n",
		// NSLog 形式でも、署名に一致しない未知のメッセージは落とさない。
		"2026-07-29 04:27:45.201 tomobit-gui[47002:33070733] error messaging the mach port for SomethingElse\n",
		"",
	}
	for _, line := range real {
		if isMacOSStderrNoise(line) {
			t.Errorf("実エラー相当を落とした: %q", line)
		}
	}
}
