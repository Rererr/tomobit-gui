//go:build production

package main

import (
	"bufio"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
)

// 子プロセス側の印。これが立っていたら自分は GUI 本体として動く。
const stderrNoiseChildEnv = "TOMOBIT_GUI_STDERR_NOISE_CHILD"

// suppressMacOSStderrNoise は自分自身を子プロセスとして起動し直し、親は
// 子の stderr から既知ノイズ（stderrnoise.go）の行だけを除いて素通しする
// 濾過器になり、子の終了コードで exit する。子側では何もしないで返る。
//
// fd 2 をパイプに差し替える in-process 方式を採らないのは、panic 時に
// ランタイムがパイプへ書いたトレースを、読み手（自プロセスの goroutine）が
// 排出しきる前にプロセスが exit して、実エラーこそが失われるため。
// 親子分離なら親が EOF まで読み切るので、落とすのは既知ノイズだけに保てる。
// dev ビルド（wails dev）を対象外にするのは、リロード時の kill が親だけを
// 倒して GUI の子が孤児として残るため（production タグで濾過ごと外れる）。
func suppressMacOSStderrNoise() {
	if os.Getenv(stderrNoiseChildEnv) == "1" {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return // 再起動できないなら濾過なしで自分がそのまま GUI になる
	}
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Env = append(os.Environ(), stderrNoiseChildEnv+"=1")
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	pipe, err := cmd.StderrPipe()
	if err != nil {
		return
	}
	if err := cmd.Start(); err != nil {
		return
	}

	// Ctrl-C は端末がフォアグラウンドのプロセスグループ全体へ届けるので、
	// 終わり方は子（GUI）に委ね、親は EOF で追随する。親宛の SIGTERM/SIGHUP
	// だけは子へ転送し、濾過器だけ死んで GUI が残る事態を避ける。
	signal.Ignore(os.Interrupt)
	terminate := make(chan os.Signal, 1)
	signal.Notify(terminate, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		for sig := range terminate {
			_ = cmd.Process.Signal(sig)
		}
	}()

	// bufio.Scanner でなく ReadString: 64KB 超の行で読み手が止まって以降の
	// stderr を全部失う事故を避ける（トークン上限がない）。
	r := bufio.NewReader(pipe)
	for {
		line, err := r.ReadString('\n')
		if line != "" && !isMacOSStderrNoise(line) {
			_, _ = os.Stderr.WriteString(line)
		}
		if err != nil {
			break
		}
	}

	err = cmd.Wait()
	if exit, ok := err.(*exec.ExitError); ok {
		if code := exit.ExitCode(); code >= 0 {
			os.Exit(code)
		}
		os.Exit(1) // シグナル死 (ExitCode -1) は失敗として 1 に写す
	}
	if err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}
