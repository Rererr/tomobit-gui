# tomobit-gui のビルド／インストール
#
# `make install` で端末から `tomobit-gui` と打つだけで起動できるようにする。
# 核 tomobit を `go install ./cmd/tomobit` で入れるのと同じ流儀で、本番ビルド
# （Wails と同一の -tags/-ldflags）を $(GOBIN) に置く。$(GOBIN) は PATH 上にある前提。

GOOS   := $(shell go env GOOS)
GOBIN  := $(shell go env GOBIN)
ifeq ($(strip $(GOBIN)),)
GOBIN  := $(shell go env GOPATH)/bin
endif

# Wails v2 本番ビルドと同じタグ（devtools 無効・埋め込み資産で動作）。
BUILD_TAGS := desktop,production
LDFLAGS    := -w -s

# macOS: production 経路が UTType を参照するため UniformTypeIdentifiers のリンクが要る
# （欠くと `_OBJC_CLASS_$$_UTType` 未解決でリンク失敗する）。
ifeq ($(GOOS),darwin)
export CGO_LDFLAGS := -framework UniformTypeIdentifiers
endif
# Windows: コンソール窓を出さない（未検証・macOS 前提の派生）。
ifeq ($(GOOS),windows)
LDFLAGS := $(LDFLAGS) -H windowsgui
endif

.PHONY: dev build install uninstall frontend test docs-check docs-sync

# ホットリロード開発（localhost:34115 でブラウザからも駆動可）
dev:
	wails dev

# 配布物（.app / .exe）を build/bin に生成
build:
	wails build

# go embed の対象となる frontend/dist を再生成
frontend:
	@[ -d frontend/node_modules ] || npm --prefix frontend install
	npm --prefix frontend run build

# 端末起動用に本番バイナリを $(GOBIN) へ。以後どこからでも `tomobit-gui`
install: frontend
	go install -tags "$(BUILD_TAGS)" -ldflags "$(LDFLAGS)" .
	@echo "installed: $(GOBIN)/tomobit-gui  —  端末で 'tomobit-gui' で起動"

uninstall:
	rm -f "$(GOBIN)/tomobit-gui"
	@echo "removed: $(GOBIN)/tomobit-gui"

test:
	go test ./...

# ADR相対リンクの参照先が実在するか、改版マークが最新かを検査する。
docs-check:
	@bash tools/check-adr-links.sh
	@bash tools/sync-adr-superseded.sh --check

# 「- 改版:」宣言から、被改版ADRの冒頭マークを生成し直す。
docs-sync:
	@bash tools/sync-adr-superseded.sh
