// throwは型を保証しない（unknown）。catchで拾える値はErrorとは限らない
// （文字列reject等）ため、Error以外はStringへ落として必ず表示可能にする。
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
