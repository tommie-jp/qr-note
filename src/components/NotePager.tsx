"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { COMPACT_SECONDARY_BUTTON_CLASS } from "@/components/ui";

// ノートのページ送り (docs/74-ページ計画.md §4)。
//
// 本文を描くのはサーバのまま。`MemoPanel` と同じく**描き終わった ReactNode を
// slot で受け取り**、いま何ページ目かだけをここが持つ (react-markdown / KaTeX を
// client 束へ引き込まないため)。
//
// 隠したページも DOM には置く。ブラウザのページ内検索が全ページに効き、
// 印刷では全ページが紙に出る。mermaid は body の一時要素で描かれるので
// (mermaidRender.ts)、隠れた枠の中でも図が壊れることはない。

export interface NotePagerPage {
  name: string;
  content: ReactNode;
}

interface NotePagerProps {
  pages: NotePagerPage[];
}

// URL のフラグメント。人が読む番号なので 1 始まり (#p3 = 3 ページ目)
const HASH_PATTERN = /^#p(\d+)$/;

function pageHash(index: number): string {
  return `#p${index + 1}`;
}

export function pageIndexFromHash(hash: string, count: number): number {
  const matched = HASH_PATTERN.exec(hash);
  if (matched === null) {
    return 0;
  }
  const page = Number(matched[1]);
  // 範囲外は 1 ページ目に丸める — 共有したリンクの番号が、ページを減らした
  // 後の本文に合わないことがある。開かないより 1 ページ目を出すほうがよい
  return page >= 1 && page <= count ? page - 1 : 0;
}

export function NotePager({ pages }: NotePagerProps) {
  const [index, setIndex] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);

  // フラグメントはサーバに届かない (URL の # から先はリクエストに乗らない)。
  // 初期描画は必ず 1 ページ目で、マウント後にここで合わせる
  useEffect(() => {
    const sync = () => {
      setIndex(pageIndexFromHash(window.location.hash, pages.length));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pages.length]);

  if (pages.length <= 1) {
    // 区切りを書いていないノートは今までどおりの見た目 (「1 / 1」を見せない)
    return pages[0]?.content ?? null;
  }

  const go = (next: number) => {
    setIndex(next);
    // 履歴を増やさずに URL だけ差し替える (Next.js のルーターと同期する
    // 公式の使い方。linking-and-navigating.md の Native History API)。
    // pushState にすると、ページを送るたびに戻るボタンが 1 段深くなる
    window.history.replaceState(null, "", pageHash(next));
    // 前のページの途中の高さのまま次のページが出ないように、本文の頭へ戻す
    topRef.current?.scrollIntoView({ block: "start" });
  };

  // 保存でページが減っても、開いていた番号は state に残る (MemoPanel は
  // パネルを unmount しないため)。描く前に丸めないと pages[index] が
  // undefined になって画面ごと落ちる
  const current = Math.min(index, pages.length - 1);
  const currentPage = pages[current];

  return (
    // scroll-mt-12 … ヘッダーが sticky (layout.tsx) なので、そのぶん手前で
    // 止めないとページを送った直後に帯が帯の下へ潜る。rem 指定なので
    // 文字サイズ設定 (docs/61) で root が伸びても一緒に伸びる
    <div className="space-y-2 scroll-mt-12" ref={topRef}>
      {/* 帯は画面だけ。紙では全ページが続けて出るので、押せない前後ボタンを
          刷らない */}
      <div className="flex items-center gap-2 print:hidden">
        <button
          type="button"
          onClick={() => go(current - 1)}
          disabled={current === 0}
          className={`${COMPACT_SECONDARY_BUTTON_CLASS} disabled:opacity-40`}
        >
          前のページ
        </button>
        <span className="shrink-0 text-sm text-gray-500 tabular-nums">
          {current + 1} / {pages.length}
        </span>
        {/* ページ名は先頭行から作った見出し (notePages.ts)。無題のページも
            あるので、名前の有無で帯の高さが変わらないよう枠は常に置く */}
        <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
          {currentPage.name}
        </span>
        <button
          type="button"
          onClick={() => go(current + 1)}
          disabled={current === pages.length - 1}
          className={`${COMPACT_SECONDARY_BUTTON_CLASS} disabled:opacity-40`}
        >
          次のページ
        </button>
      </div>

      {pages.map((page, i) => (
        <div
          // ページは本文の切れ端で、順番より他に見分ける印が無い
          key={i}
          // **hidden 属性では隠さない。** それだと印刷でも消える
          // (MemoPanel のタブが「開いているタブしか刷れない」のと同じ罠)
          className={`${i === current ? "" : "hidden print:block"} ${
            i === 0 ? "" : "print:break-before-page"
          }`}
        >
          {page.content}
        </div>
      ))}
    </div>
  );
}
