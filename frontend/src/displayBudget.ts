// 表示の予算 (本体 ADR-0032: 本体はツール出力を無加工・上限なしで流し、
// 表示予算は消費者=GUI が持つ)。
//
// 2026-07-26 の応答停止の後始末。凍りの主因は本文の再パースだったが、
// ツール出力の側には別の青天井が残っていた: 1件の tool_result は本体の契約上
// いくらでも大きくなりうる（大きなファイルの Read、長いログの tail）のに、
// GUI はそれを丸ごと文字列で持ち、丸ごと DOM へ入れていた。畳んである間は
// レイアウトされないので凍りはしないが、長いターンでは積み上がるだけ積み上がる。
//
// 切るが、黙っては切らない —— runcommand.go の truncateOutput / Truncated と
// 同じ姿勢。頭と尻を残して真ん中を抜くのは、ツール出力では「何を返し始めたか」
// と「どう終わったか」の両方が読まれるため（片方だけ残すコマンド出力の作法とは
// ここが違う）。
//
// 全文が消えるわけではない: スクロールバックは Go 側の pumpViewStream が
// フロントより手前で生の NDJSON を書いているので、残す設定なら台帳の隣に全文が
// ある。ここで削るのは画面に載せる分だけ。

/** 1件の tool_result を画面に載せる上限。runcommand.go の 64KB と同じ目盛り。 */
export const toolResultDisplayLimit = 64 * 1024;

/**
 * text が limit を超えていたら、頭と尻を残して中略する。切ったときは何文字
 * 落としたかを本文の中で必ず名乗る（黙って切らない）。
 *
 * 切れ目は行の境界へ寄せる: 途中で切ると壊れた行が頭と尻にぶら下がり、
 * 何が落ちたのかがかえって読めなくなる。
 */
export function budgetToolResult(text: string, limit: number = toolResultDisplayLimit): string {
  if (text.length <= limit) {
    return text;
  }
  const keep = Math.floor(limit / 2);
  let head = text.slice(0, keep);
  let tail = text.slice(text.length - keep);
  // 行の境界へ寄せる。境界が見つからない（1行が巨大）なら、そのままの位置で切る。
  const headCut = head.lastIndexOf("\n");
  if (headCut > 0) {
    head = head.slice(0, headCut);
  }
  const tailCut = tail.indexOf("\n");
  if (tailCut >= 0 && tailCut < tail.length - 1) {
    tail = tail.slice(tailCut + 1);
  }
  const dropped = text.length - head.length - tail.length;
  return `${head}\n\n… 中略: ${dropped.toLocaleString("en-US")} 文字（画面に載せる上限を超えた分）…\n\n${tail}`;
}
