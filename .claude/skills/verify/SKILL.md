---
name: verify
description: tomobit-gui（Wails v2デスクトップGUI）を実データに触れず起動し、playwright-coreでpixel面を実際に駆動して検証する手順
---

# tomobit-gui の検証手順

## 鉄則（2026-07-24 実害から追加）

1. **wails dev は自分で起動し、共有しない**。起動前に既存インスタンスを確認して kill し、
   検証後に自分のプロセスを必ず終了する。複数エージェント/セッションが port 34115 を
   共有すると、HMR リロードで互いの観測が汚染される（実例: レビュー中に別作業の編集で
   ペインが勝手に遷移し、無関係の疑義が報告された）
2. **実台帳とそのコピーを検証に使わない**。実会話（機微情報）が検証ログ・スクリーン
   ショットに写り込む。テストデータは SCHEMA.md 準拠の合成フィクスチャを sqlite3 で作る

## 起動（実データ非破壊）

`~/.tomobit/tomobit.db` を直接汚さないよう、必ず `TOMOBIT_DB` を使い捨てパスに向ける。顔窓は検証に不要なら `TOMOBIT_FACE=0` で抑止する。

```bash
mkdir -p /path/to/scratch/testdb
TOMOBIT_DB=/path/to/scratch/testdb/test.db TOMOBIT_FACE=0 \
  nohup wails dev > /path/to/scratch/wails-dev.log 2>&1 &
disown
timeout 45 bash -c 'until curl -sf http://localhost:34115 >/dev/null; do sleep 1; done'
```

`wails dev` はポート34115で待ち受け、ブラウザから同じバインド済みGoメソッド・イベントを叩ける（README記載の想定運用）。

## 駆動（playwright-core、ヘッドレスChrome）

このリポジトリに `playwright-core` の依存は無い。`npx`だとESM解決に失敗するため、scratch dirにローカルinstallしてから使う:

```bash
cd /path/to/scratch && npm init -y >/dev/null 2>&1 && npm install playwright-core
```

```js
import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto("http://localhost:34115", { waitUntil: "networkidle" });
```

## 実バックエンドを起動せずにチャット描画だけ検証する

`window.runtime.EventsEmit` はローカルの購読者へ直接ループバックする（Wails runtimeへの実際の往復も、`tomobit chat`子プロセスの起動も不要）。ChatPaneの構造化view描画をコストゼロ・実LLM課金ゼロで検証できる:

```js
await page.evaluate(() => {
  window.runtime.EventsEmit("chat:view", { type: "turn.started", n: 1, provider: "claude-code" });
  window.runtime.EventsEmit("chat:view", { type: "text", text: "**太字**\n\n- 項目" });
  window.runtime.EventsEmit("chat:view", { type: "turn.finished", duration_ms: 500, cost_usd: 0.01 });
});
```

同様に `window.go.main.App.<MethodName>` を差し替えると `GetSessions`/`GetMemoryView`/`SendLine` 等のGo bindingもモックできる（`SendLine`をモックすればクリック操作のフォーカス挙動等を実課金無しで検証可）。

## 実インターフェース経由の本物のターンを1回は通す

上記の注入だけで済ませず、golden pathは最低1回、`.chat-input` に入力 → `.chat-send-btn` クリックで実際に送らせ、`.chat-turn-meta` の出現を待つ（ターン終了時のメタ行 — GUI ADR-0014 Decision 3 で旧 `.chat-turn-footer` を統合した後継。実`tomobit chat`プロセスが起動し実LLMへ課金される — 使い捨てDBでの1回に留める）。

## 既知のgotcha

- **Bashの永続シェルでcwdが勝手に戻ることがある**（node scriptの実行後など）。相対パスに頼らず毎回 `cd` するか絶対パスを使う
- `page.click("text=設定")` のような緩い text= セレクタは、サイドバーのセッション一覧に**表示上は省略されていても実DOM上はフルテキストの** intent が乗っており、そこに偶然「設定」「メモリ」等の語が含まれ誤クリックすることがある。ナビには `.sidebar-footer >> text=設定` のように親要素で絞る
- 起動直後、コンソールに `TypeError: Cannot read properties of null (reading 'nodes')` と 404 が1回ずつ出るのは既知の環境ノイズ（Wails dev-modeのブラウザ橋渡し由来、実装のバグではない）。新規エラーとの差分で判断する
- **検証で実送信ボタンを押すと本物の `tomobit chat` プロセスが起動し実LLM課金が走る**。フォーカス挙動などUIだけ見たい場合は必ず `window.go.main.App.SendLine` をモックしてから操作する

## 後片付け

`wails dev` → アプリ本体(`build/bin/tomobit-gui.app/...`) → `tomobit chat` の3階層プロセスツリーになる。ポートkillだけでは孫プロセスが残ることがあるため、`ps aux | grep -E "tomobit-gui.app|wails dev|tomobit chat"` で確認してPID指定でkillする。
