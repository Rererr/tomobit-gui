/**
 * 並走する子の枠を、番号で引ける形に保つ（本体 ADR-0032 の `sub`）。
 *
 * 本体 ADR-0056 で独立宣言された群が実際に並走するようになり、view ストリームに
 * **同時に複数のフレームが開く**状態が生まれた。それまでは「いま開いている枠」を
 * ひとつ持てば足りていた — サブタスクは1本ずつ開いて閉じたからである。
 *
 * ここが持つのは、その1つが K 個になったときの当て先の決め方だけ:
 *
 * - `sub` を持たない行は**会話そのもののターン**へ（内訳ではない）
 * - `sub` を持つ行はその番号の枠へ
 * - 閉じるのは自分の枠だけ。隣はまだ走っている
 *
 * ライブ（useChatSession）と過去の再生（viewFold）が同じ規則で動くように、
 * 両方がこの1つを通す。枠の実体はライブがメッセージ id、再生が配列 index と
 * 違うので、参照の型は呼び出し側が決める。
 *
 * 型だけの依存で閉じてある — このリポジトリでテストできるモジュールは、
 * ランタイムの import を持たないものに限られる（permission.ts と同じ理由）。
 */
export class SubtaskFrames<T> {
  private readonly open = new Map<number, T>();

  /** その番号の枠を開く（開き直しは上書き）。 */
  start(sub: number, ref: T): void {
    this.open.set(sub, ref);
  }

  /**
   * この行の当て先。`sub` が無ければ `main`（会話そのもののターン）。
   * まだ枠の無いサブタスクは null — 呼び出し側が開いて受ける。
   */
  target(sub: number | undefined, main: T | null): T | null {
    if (sub === undefined) {
      return main;
    }
    return this.open.get(sub) ?? null;
  }

  /**
   * その番号の枠を閉じて、閉じた枠を返す。`sub` が無ければ何もせず null —
   * 会話そのもののターンを閉じるのは呼び出し側の仕事で、ここは内訳だけを見る。
   *
   * **隣は閉じない。** 並走の最中に先に終わった子の turn.finished が全員を
   * 閉じてしまう、というのがこの型を作るまでの壊れ方だった。
   */
  finish(sub: number | undefined): T | null {
    if (sub === undefined) {
      return null;
    }
    const ref = this.open.get(sub);
    if (ref === undefined) {
      return null;
    }
    this.open.delete(sub);
    return ref;
  }

  /** まだ走っている子の数。 */
  get running(): number {
    return this.open.size;
  }
}
