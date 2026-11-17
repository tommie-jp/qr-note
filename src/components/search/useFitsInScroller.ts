"use client";

import { type RefObject, useEffect, useState } from "react";
import { afterNextPaint } from "@/lib/afterNextPaint";
import { canScroll } from "./loadMoreGate";

// 一覧が器 (スクロールする器、無ければ文書) に収まっているかを見張る
// (docs/118 §2-6)。AutoLoadMore は、利用者がスクロールする前でも、収まって
// いる間は続きを自動で足す。
//
// **一度測るだけでは足りない。** 表示モードの切替 (大 → 画像)・ウィンドウの
// 拡大・下部ペインの境のドラッグ・行のゴミ箱送りで、あとから一覧が器に
// 収まることがある。測り直さないと「さらに表示」を押すまで止まっていた。
// ResizeObserver で器と一覧の中身の大きさの変化を拾って測り直す。通知は
// レイアウトの済んだ時点で届くので、そこで高さを読んでも余分なレイアウトは
// 起きない (表示モード切替の即時を延ばさない。docs/123 §11-7)

// 一覧が内側でスクロールしている器 (2 / 3 ペイン・広い画面の [data-results-scroll])。
// **実際に overflow でスクロールしているときだけ** root にする — 文書ごと
// スクロールする構成 (1 ペインの狭い画面) で器を root にすると、器は切り取らない
// ので目印が常に「見えている」扱いになり、全ページを連鎖読み込みしてしまう
export function scrollRootOf(el: HTMLElement): HTMLElement | null {
  const scroller = el.closest<HTMLElement>("[data-results-scroll]");
  if (scroller === null) {
    return null;
  }
  const { overflowY } = getComputedStyle(scroller);
  return overflowY === "auto" || overflowY === "scroll" ? scroller : null;
}

// 一覧 (スクロールする器、無ければ文書) がスクロールできる長さか。
// **器か文書かは測るたびに決め直す。** 1 ペインでは器が送るのは広い画面
// だけで (globals.css の幅の条件)、ウィンドウの幅が境をまたぐと送る側が入れ替わる
export function isListScrollable(el: HTMLElement): boolean {
  const root = scrollRootOf(el);
  return root === null
    ? canScroll(document.documentElement.scrollHeight, window.innerHeight)
    : canScroll(root.scrollHeight, root.clientHeight);
}

interface Measured {
  key: string;
  fits: boolean;
}

// 収まっていれば true、収まっていなければ false、まだ測っていなければ null。
// key … 測り直す単位 (検索と構成)。別の key で測った値は返さない — 前の検索の
// 「収まっている」を新しい検索に持ち込んで、スクロール前に読んでしまわないため。
// enabled が false の間は見張らない (解禁済み・ノートに覆われている間は要らない)。
// 見張りを止めたら測った値も捨てる — 覆われている間に収まらなくなっていても
// 古い「収まっている」を返さないため
export function useFitsInScroller(
  sentinelRef: RefObject<HTMLElement | null>,
  key: string,
  enabled: boolean,
): boolean | null {
  const [measured, setMeasured] = useState<Measured | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    const content = el?.parentElement;
    if (el === null || content == null || !enabled) return;
    let detach: (() => void) | undefined;
    // 測り始めるのは描画の後。scrollRootOf の getComputedStyle を描画の直後に
    // 読むと、スタイルを前倒しで強制し検索結果の最初の 1 枚を遅らせる (docs/122 §10-2)
    const cancel = afterNextPaint(() => {
      const measure = () => {
        const fits = !isListScrollable(el);
        setMeasured((prev) =>
          prev?.key === key && prev.fits === fits ? prev : { key, fits },
        );
      };
      // 器 (内側スクロールの高さ)・文書 (文書スクロールでは html の高さ =
      // 中身の高さ)・一覧の中身 (特性表・行・目印) の大きさ。ResizeObserver の
      // 通知はレイアウトの済んだ時点なので、そこで測っても強制にならない
      const resize = new ResizeObserver(measure);
      const scroller = el.closest<HTMLElement>("[data-results-scroll]");
      const observeAll = () => {
        resize.disconnect();
        resize.observe(document.documentElement);
        if (scroller !== null) resize.observe(scroller);
        for (const child of Array.from(content.children)) {
          resize.observe(child);
        }
      };
      // 一覧の要素が差し替わったら (表示モードで器の要素が替わる) 見張り直す
      const mutation = new MutationObserver(observeAll);
      mutation.observe(content, { childList: true });
      observeAll();
      // 文書スクロールで画面の高さだけが変わった分は上の見張りに出ないので
      // resize で拾う。ドラッグ中は毎フレーム届くので、描画の後に 1 回にまとめる
      let cancelResize: (() => void) | undefined;
      const onResize = () => {
        cancelResize ??= afterNextPaint(() => {
          cancelResize = undefined;
          measure();
        });
      };
      window.addEventListener("resize", onResize);
      detach = () => {
        resize.disconnect();
        mutation.disconnect();
        window.removeEventListener("resize", onResize);
        cancelResize?.();
      };
    });
    return () => {
      cancel();
      detach?.();
      setMeasured(null);
    };
  }, [sentinelRef, key, enabled]);

  return measured?.key === key ? measured.fits : null;
}
