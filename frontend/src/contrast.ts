// WCAG 2.1 のコントラスト比と、App.css の :root トークンの読み出し。
//
// 配色は「好み」で動かせる場所なので、動かした結果が読めなくなっていないかを
// 機械が言う側に置く（contrast.test.ts が実際の組み合わせを検査する）。
// 比率をCSSのコメントに書き写す運用は必ず腐るので、値は1箇所（App.css）に
// だけ置き、比率はここで計算する。

/** sRGB の 1 チャンネルを線形化する（WCAG 2.1 relative luminance の定義）。 */
function linearize(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** #rrggbb を相対輝度へ。3桁記法・alpha は使っていないので受け付けない。 */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (m === null) {
    throw new Error(`6桁の #rrggbb ではない色: ${hex}`);
  }
  const n = parseInt(m[1], 16);
  return (
    0.2126 * linearize((n >> 16) & 0xff) +
    0.7152 * linearize((n >> 8) & 0xff) +
    0.0722 * linearize(n & 0xff)
  );
}

/** 2色のコントラスト比（1.0〜21.0）。前後どちらの順でも同じ値を返す。 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * App.css の :root ブロックから `--color-*` を拾う。CSSパーサは入れない —
 * 対象は自分で書いた1ブロックだけで、想定外の記法（var() の入れ子・calc・
 * 色関数）が入ったら「値が取れない」のではなく「静かに間違った値を取る」方が
 * 怖い。だから素直な `--name: #rrggbb;` 以外は拾わず、テスト側が
 * 「期待したトークンが無い」で落ちる。
 */
export function parseRootColorTokens(css: string): Record<string, string> {
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css);
  if (root === null) {
    throw new Error("App.css に :root ブロックが見つからない");
  }
  const tokens: Record<string, string> = {};
  for (const m of root[1].matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[m[1]] = m[2];
  }
  return tokens;
}
