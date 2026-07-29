import { useEffect, useRef } from "react";
import { FOCUSABLE_SELECTOR, nextFocusTarget } from "./focusTrap";

/**
 * モーダル内で Tab / Shift+Tab を先頭⇔末尾に巡回させる (WAI-ARIA dialog
 * パターン)。返した ref をダイアログの role="dialog" 要素に渡して使う。
 *
 * AppClosingSheet / NewChatConfirmDialog / PermissionDialog の3つに適用する
 * ため、外部ライブラリを増やさず自前で持つ（アプリ全体でこの1形だけ）。
 *
 * 対象は Tab のたびに querySelectorAll で数え直す —
 * AppClosingSheet は節ごとに選択肢/自由記述/待ち状態が入れ替わるため、
 * マウント時に1度だけ集めると次の問いが来たときに古いリストのままになる。
 */
export function useFocusTrap<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") {
        return;
      }
      // container はナロー済みだが、ネストした関数(クロージャ)の中では
      // TypeScript の control flow narrowing が及ばないため、ここで
      // containerRef.current を読み直して確実な非null値にする。
      const current = containerRef.current;
      if (current === null) {
        return;
      }
      const focusable = Array.from(current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      // document.activeElement の型は Element | null。focus() を持つのは
      // HTMLElement 側なので、querySelectorAll の要素型に合わせてここで絞る
      // （実際にフォーカスが当たるのは常にHTMLElementの子孫）。
      const active = document.activeElement as HTMLElement | null;
      const target = nextFocusTarget(focusable, active, event.shiftKey);
      if (target !== null) {
        event.preventDefault();
        target.focus();
      }
    }

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, []);

  return containerRef;
}
