import { memo, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { BrowserOpenURL } from "../../wailsjs/runtime/runtime";
import type { main } from "../../wailsjs/go/models";
import { commandFromFence, isRunnable } from "../commandBlock";
import { errorMessage } from "../errorMessage";
import { useRunCommand } from "./RunCommandProvider";
import { RunCommandStrip } from "./RunCommandStrip";

// pre>codeの子要素からコピー対象の生テキストを復元する。fenced code blockの
// 中身はremarkがインライン記法を解釈しないため、実質は単一の文字列ノードだが、
// 構文ハイライトのプラグインが将来入っても崩れないよう再帰で拾う。
function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  if (node !== null && typeof node === "object" && "props" in node) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

// フェンスの言語は `<code>` の className（`language-sh` 等）に載る。pre の
// override が受け取る children はその code 要素なので、props から取り出す。
function fenceClassName(node: ReactNode): string | undefined {
  if (node !== null && typeof node === "object" && "props" in node) {
    const className = (node.props as { className?: unknown }).className;
    return typeof className === "string" ? className : undefined;
  }
  return undefined;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  // 確認の帯を開いているか (ADR-0007 Decision 3)。1度目のクリックはここを
  // 開くだけで、走らせるのは帯の中の2度目。
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<main.CommandRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const runCommand = useRunCommand();

  const text = extractText(children);
  const command = commandFromFence(text);
  const runnable = runCommand.enabled && isRunnable(fenceClassName(children), text);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      // クリップボード権限拒否等。握り潰さずボタン文言で伝える。
      setStatus("error");
    }
    setTimeout(() => setStatus("idle"), 1500);
  }

  async function handleRun() {
    setRunning(true);
    setRunError(null);
    try {
      setResult(await runCommand.run(command));
      // 走った後は帯を閉じる: 開いたままだと、結果を読んでいる最中に
      // 「実行」がもう一度押せる位置に居座る。
      setConfirming(false);
    } catch (err) {
      // 起動できなかった・設定が OFF・別のコマンドが走っている。握り潰さない。
      setRunError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="md-code-block">
      <div className="md-code-actions">
        {runnable && (
          <button
            className="md-code-run-btn"
            onClick={() => setConfirming((open) => !open)}
            disabled={running}
            aria-expanded={confirming}
          >
            {confirming ? "やめる" : "▶ 実行"}
          </button>
        )}
        <button className="md-code-copy-btn" onClick={() => void handleCopy()}>
          {status === "copied" ? "コピーした" : status === "error" ? "コピー失敗" : "コピー"}
        </button>
      </div>
      <pre>{children}</pre>
      {runnable && (
        <RunCommandStrip
          command={command}
          workingDir={runCommand.workingDir}
          confirming={confirming}
          running={running}
          result={result}
          error={runError}
          onRun={() => void handleRun()}
          onCancel={() => setConfirming(false)}
          onDismissResult={() => {
            setResult(null);
            setRunError(null);
          }}
        />
      )}
    </div>
  );
}

const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

// javascript:等の危険なスキームをOSへ渡さないための許可制チェック。基点URLを
// 渡さないため相対参照は例外で弾かれる — BrowserOpenURLへ渡すのは常に非解決の
// 生文字列なので、絶対URLとして意味を持つ入力だけを「安全」とみなす。
function isSafeURL(href: string): boolean {
  try {
    return SAFE_URL_SCHEMES.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

// 画像は自動読み込みしない — Markdown画像はクリック等のユーザー操作無しに
// リモートへ通信する受動的な情報流出経路になり得る（altとURLだけ見せ、
// 開くかはユーザーに委ねる。rehype-rawを退けた理由と同じ「コストゼロで
// 塞げる穴は塞ぐ」判断）。
function MdImage({ src, alt }: { src?: string; alt?: string }) {
  if (src === undefined) {
    return null;
  }
  return (
    <span className="md-image-placeholder">
      画像: {alt !== undefined && alt !== "" ? alt : src}
      {isSafeURL(src) && (
        <button className="md-image-open-btn" onClick={() => BrowserOpenURL(src)}>
          開く
        </button>
      )}
    </span>
  );
}

// リンクはWebViewの自己遷移ではなくシステムブラウザで開く — Wailsは別ウィンドウの
// chromeを持たないため、素のtarget="_blank"はアプリの中身を消してナビゲートする。
const components: Components = {
  a: ({ href, children, node: _node, ...props }) => (
    <a
      {...props}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href !== undefined && isSafeURL(href)) {
          BrowserOpenURL(href);
        }
      }}
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) => <MdImage src={src} alt={alt} />,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

/** Tomoの発言テキストのMarkdown描画。rehype-rawは使わない — HTMLは解釈せず
 * ASTからReact要素だけを組む(生HTML実行経路を作らない)。textが同じ間は
 * 再パースしない — 会話が伸びるほど、無関係な再描画（入力欄への1文字ごと等）
 * のたびに全履歴のMarkdownを再構築するコストが無視できなくなる。
 *
 * 既知の未対応（意図的）: 地の文中の裸の`*`（例: "3*4=12"）はCommonMarkの
 * 強調デリミタと解釈され、対になる`*`が現れると間の文字列が強調化され記号
 * 自体は消える。`_`と違い単語内保護が無いための仕様上の挙動で、確実な回避策
 * が無く、自由文とMarkdownを同時解釈する製品（ChatGPT等）に共通するトレード
 * オフとして受け入れる（ui-ux-reviewerサブエージェントのレビューで指摘・検討
 * 済み、2026-07-21）。 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
