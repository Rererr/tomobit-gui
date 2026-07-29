/** モーダル内でTab巡回の対象とみなす、フォーカス可能な要素の集合
 *  (WAI-ARIA dialogパターンの通例に沿う最小集合)。 */
export const FOCUSABLE_SELECTOR =
  'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Tab / Shift+Tab で巡回させたとき、次にフォーカスすべき要素を返す。
 *
 * 先頭⇔末尾の折り返しだけを担う。それ以外（中間の要素にいる、または
 * フォーカスがリストの外にある）は null を返し、ブラウザ既定の移動に委ねる。
 * リスト外のフォーカスを強制的に奪わないのは、締めと権限、2つのモーダルが
 * 同一窓で重なることがあり (App.css の permission-backdrop 参照)、その場合
 * 背後のモーダルのトラップが前面のモーダルからフォーカスを奪い返すのを
 * 避けるため。
 */
export function nextFocusTarget<T>(
  focusable: readonly T[],
  active: T | null,
  shiftKey: boolean,
): T | null {
  if (focusable.length === 0 || active === null) {
    return null;
  }
  const currentIndex = focusable.indexOf(active);
  if (currentIndex === -1) {
    return null;
  }
  if (shiftKey && currentIndex === 0) {
    return focusable[focusable.length - 1];
  }
  if (!shiftKey && currentIndex === focusable.length - 1) {
    return focusable[0];
  }
  return null;
}
