//go:build !darwin || !production

package main

// suppressMacOSStderrNoise は darwin の production ビルド以外では no-op。
// このノイズは macOS 固有で、dev ビルド（wails dev）は親子分離すると
// リロード時の kill で GUI の子が孤児になるため、対象から外している。
func suppressMacOSStderrNoise() {}
