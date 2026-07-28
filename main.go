package main

import (
	"embed"
	"fmt"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// 親（濾過器）モードならこの中で exit し、以降は子だけが GUI として続く。
	suppressMacOSStderrNoise()

	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "Tomobit",
		Width:  1100,
		Height: 760,
		// 固定260pxサイドバー + チャット面の最小実用幅。これ未満は設定の
		// textarea が1文字/行まで潰れる（実機レビューで確認された破綻点）。
		MinWidth:  640,
		MinHeight: 480,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		// 窓の×は即座には閉じない（ADR-0005）: 生きている chat があれば締めの
		// 器官を走らせ、質問に答えてから閉じる。
		OnBeforeClose: app.beforeClose,
		OnShutdown:    app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		fmt.Fprintln(os.Stderr, "tomobit-gui: 起動に失敗:", err)
		os.Exit(1)
	}
}
