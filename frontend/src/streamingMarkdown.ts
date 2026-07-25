// 流れている最中の本文を、確定した段落と伸びている末尾に切り分ける
// (2026-07-26 の応答停止への修正)。
//
// 事故の主因はここだった。ターンの本文は1つの text ブロックへ結合され続け、
// その全文が更新のたびに react-markdown で再パースされていた。1回の費用が
// 累積量に比例するので、総費用は長さの二乗で伸びる。実測（修正前・本番相当の
// 経路）では 400件ごとの1件あたりが 0.21ms → 14.88ms（累積15,675字の時点で
// 71倍）まで伸び、26分のターンではフレームが返らなくなる。
//
// 直し方: 本文は追記しかされないので、空行より前は二度と変わらない。そこで
// 切って別々の Markdown へ渡せば、確定ぶんは memo が再パースを飛ばし、
// 毎フレーム解き直すのは伸びている末尾だけになる。
//
// 切ってよいのは流れている最中だけ (ChatMessageView が finished で分ける):
// 段落ごとに独立してパースすると、緩いリストの解釈など細部が全文パースと
// 食い違いうる。ターンが終わったら全文を1回で解き直すので、残る表示は
// 従来と1文字も変わらない。

// 行がフェンスの開始・終了かを見る。``` と ~~~ は別種で、開いた側と同じ記号
// でしか閉じない（CommonMark）。
function fenceMarker(line: string): string | null {
  const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  return m === null ? null : m[1][0];
}

// 空行が来ないまま伸びた末尾を、これを超えたら切ってよいことにする目安（バイト
// ではなく文字数）。小さくすると切れ目が増えて見た目が段落だらけになり、大きく
// すると再パースの費用が戻ってくる。2000字は、実測で1回のパースが1ms前後に
// 収まる大きさ。
const streamingTailSoftLimit = 2000;

// 次の行が「独立したブロックの始まり」に見えるか。ここでしか強制的な切れ目を
// 作らない — 継続行・リストの項目・表の行・引用の途中で切ると、1つの構造が
// 2つに割れて描画が変わってしまう。
function isSafeBlockStart(line: string): boolean {
  if (line.trim() === "") {
    return false; // 空行はそもそも通常の切れ目が拾う
  }
  if (/^[ \t]/.test(line)) {
    return false; // 継続行・インデントされたコード
  }
  if (/^([-*+]|\d+[.)])\s/.test(line)) {
    return false; // リスト項目（切ると別のリストになる）
  }
  if (/^[|>]/.test(line)) {
    return false; // 表の行・引用（切ると崩れる）
  }
  if (/^[=-]{2,}\s*$/.test(line)) {
    return false; // setext の下線 / 罫（切ると直前の行の意味が変わる）
  }
  return true;
}

/**
 * text を「確定した段落…, 伸びている末尾」の順に切って返す。最後の要素だけが
 * まだ伸びうる — 呼び出し側はそれ以外を安定した key で描いてよい。
 *
 * 空行はフェンス（コードブロック）の外にあるものだけが切れ目。フェンスの中の
 * 空行で切ると、1つのコードブロックが2つに割れて描画そのものが壊れる。
 */
export function splitStreamingMarkdown(text: string): string[] {
  const segments: string[] = [];
  const lines = text.split("\n");
  let current: string[] = [];
  let currentLen = 0;
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = fenceMarker(line);
    if (marker !== null) {
      if (fence === null) {
        fence = marker;
      } else if (marker === fence) {
        fence = null;
      }
    }
    current.push(line);
    currentLen += line.length + 1;
    const hasContent = currentLen > 0 && current.some((l) => l.trim() !== "");
    if (fence !== null || !hasContent) {
      continue;
    }
    // 切れ目は「フェンスの外の空行」。中身が空のまま切ると空の段落が並ぶので、
    // 何か書かれている時だけ確定させる。
    const atBlankLine = line.trim() === "";
    // 空行が一度も来ないまま伸び続ける本文（箇条書きだけの長い列挙、改行なしの
    // 長文）への歯止め。空行を待つだけだと末尾が青天井に伸び、再パースの費用が
    // また累積量に比例してしまう。次の行が独立したブロックの始まりに見える時
    // だけ切る — 継続行やリストの途中で切ると、1つの構造が2つに割れて見える。
    const atForcedCut =
      currentLen > streamingTailSoftLimit && isSafeBlockStart(lines[i + 1] ?? "");
    if (atBlankLine || atForcedCut) {
      segments.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }
  }
  segments.push(current.join("\n"));
  return segments;
}
