// 作業バー (ADR-0004 Decision 4) のパス表示。バーは1行に収まっている必要が
// あるので、全長ではなく末尾の2階層だけを見せる — 人がフォルダを見分けるのに
// 使うのはたいてい末尾で、判別に足りなければ title の全長で確かめられる。

export function displayDir(path: string): string {
  const segments = path.split("/").filter((s) => s !== "");
  if (segments.length === 0) {
    // "/" もここに来る（空文字は呼び出し側が未設定として扱う）。
    return path === "" ? "" : "/";
  }
  return segments.slice(-2).join("/");
}

// read_dirs への追加は同じ場所を二度積まない（Go 側 NormalizedReadDirs と
// 同じ正規化を、押した瞬間の見た目にも効かせる）。作業ディレクトリ自身は
// Provider が元から読めるので、読み取り先としては重複になる。
export function addReadDir(readDirs: string[], workingDir: string, dir: string): string[] {
  if (dir === "" || dir === workingDir || readDirs.includes(dir)) {
    return readDirs;
  }
  return [...readDirs, dir];
}
