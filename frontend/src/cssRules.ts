// App.css のルールを、セレクタで引ける形に読む。
//
// contrast.ts と同じ姿勢: CSSパーサは入れない。対象は自分で書いた1枚だけで、
// 想定外の記法が入ったら「読めない」のではなく「静かに間違った値を読む」方が
// 怖いので、素直な `セレクタ { 宣言 }` 以外は拾わない。
//
// 何のために在るか: 見た目の規律のうち、**壊れても誰も気づかないもの**を
// 機械に見張らせるため（フォーカスの輪郭が消えた・待ちの姿が filter に戻った、
// など）。描画結果そのものはここでは分からないので、見張れるのは
// 「その規律が CSS の形として在るか」までである — テストで守れる形に設計を
// 寄せた分だけが守られる。

/** ひとつのルール。`.a, .b { … }` のようにセレクタが複数なら、全部が selectors に入る。 */
export interface CssRule {
  selectors: string[];
  declarations: Record<string, string>;
}

function parseDeclarations(body: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const part of body.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) {
      continue;
    }
    const property = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (property !== "" && value !== "") {
      declarations[property] = value;
    }
  }
  return declarations;
}

/**
 * トップレベルのルールを順に読む。コメントは先に落とす（`/* … *\/` の中に
 * `{}` が入っていることがある）。入れ子（@media 等）は対象外 — 読めないものは
 * 拾わないので、期待するルールが無ければ呼んだ側が落ちる。
 */
export function parseCssRules(css: string): CssRule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]
      .split(",")
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter((s) => s !== "");
    if (selectors.length === 0) {
      continue;
    }
    rules.push({ selectors, declarations: parseDeclarations(m[2]) });
  }
  return rules;
}

/** そのセレクタを含むルール全部（後勝ちの順のまま）。 */
export function rulesFor(css: string, selector: string): CssRule[] {
  const want = selector.replace(/\s+/g, " ");
  return parseCssRules(css).filter((rule) => rule.selectors.includes(want));
}

/**
 * そのセレクタに効く宣言をまとめたもの。同じ property が複数回あれば後の勝ち
 * （同じ詳細度の中での話。詳細度の違うセレクタは別物として数えない）。
 */
export function declarationsFor(css: string, selector: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of rulesFor(css, selector)) {
    Object.assign(merged, rule.declarations);
  }
  return merged;
}
