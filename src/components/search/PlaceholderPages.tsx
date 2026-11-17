"use client";

import { memo, type RefObject, useCallback, useEffect, useRef } from "react";
import { COMPACT_ACTION_LINK_CLASS } from "@/components/ui";
import { listClassOf } from "@/components/item/itemListParts";
import { afterNextPaint } from "@/lib/afterNextPaint";
import { perfStart } from "@/lib/perf/perfClient";
import type { ViewMode } from "@/lib/prefs/viewMode";
import { PREFETCH_MARGIN } from "./AutoLoadMore";
import { LOAD_MORE_EVENT } from "./loadMore";
import { lastVisiblePage, PLACEHOLDER_HEIGHT, type PlaceholderChunk } from "./placeholderPlan";
import { scrollRootOf } from "./useFitsInScroller";
import { useCoveredByNote, useScrollArmed } from "./useScrollArmed";

// 検索一覧の末尾に並べる、まだ読んでいないノートの空の枠 (docs/129 §1)。
//
// 1 ページ目が届いた時点で件数は分かっているので、続きの枠を先に並べて
// スクロールできるようにする。枠はページ (20 件) ごとの塊で、塊が画面に
// 入ったら、そのページまでを 1 回で取りに行き (onLoadThrough)、届いたら
// 本物の行に置き換わる。
//
// 読み始めの門は AutoLoadMore と同じ (docs/118 §2): **画面に見えている枠は
// すぐ埋める** (誰も読み進めていなくても、空の枠を見せたままにしない)。
// 1 画面先の先読みは、利用者が下へスクロールしてから。
//
// 末尾の「さらに表示」は残り件数の表示と、IntersectionObserver が効かない
// 環境の受け皿。data-auto-load-more は続きがある目印 (loadMore.ts が見る)

interface PlaceholderPagesProps {
  searchKey: string;
  view: ViewMode;
  chunks: readonly PlaceholderChunk[];
  // まだ出ていないノートの数 (枠の分も含む)
  remaining: number;
  onLoadThrough: (page: number) => void;
  isPending: boolean;
  failed: boolean;
  onRetry: () => void;
}

export function PlaceholderPages({
  searchKey,
  view,
  chunks,
  remaining,
  onLoadThrough,
  isPending,
  failed,
  onRetry,
}: PlaceholderPagesProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { coveredByNote, mode } = useCoveredByNote();
  const armed = useScrollArmed(ref, searchKey, { enabled: !coveredByNote, mode });
  const firstPage = chunks[0]?.page ?? 0;
  const lastPage = chunks.at(-1)?.page ?? firstPage;

  const load = useCallback(
    (page: number) => {
      // 速度計測の開始 (docs/119 §3-1)。計測中でなければ何もしない
      perfStart("追加", "/");
      onLoadThrough(page);
    },
    [onLoadThrough],
  );

  // key … 塊が入れ替わる (ページが届く) か、表示モードで枠の要素が作り直されたら張り直す
  useWatchChunks(ref, { key: `${firstPage}-${lastPage}-${view}`, armed, enabled: !coveredByNote && !failed, mode, load });

  // 画像ビューアの → からの頼み (loadMore.ts)。次のページを読む
  useEffect(() => {
    const onRequest = () => load(firstPage);
    window.addEventListener(LOAD_MORE_EVENT, onRequest);
    return () => window.removeEventListener(LOAD_MORE_EVENT, onRequest);
  }, [load, firstPage]);

  return (
    <div ref={ref} data-auto-load-more="" className="space-y-2">
      {chunks.map((chunk) => (
        <ChunkFrames key={chunk.page} chunk={chunk} view={view} />
      ))}
      <MoreButton
        remaining={remaining}
        isPending={isPending}
        failed={failed}
        onClick={failed ? onRetry : () => load(lastPage)}
      />
    </div>
  );
}

// 末尾の「さらに表示」。overflow-anchor: none … この要素をスクロールの基準に
// させない (AutoLoadMore の注)。aria-live … 読み込まれたことを控えめに伝える
function MoreButton({
  remaining,
  isPending,
  failed,
  onClick,
}: {
  remaining: number;
  isPending: boolean;
  failed: boolean;
  onClick: () => void;
}) {
  return (
    <div aria-live="polite" className="flex justify-center py-2 [overflow-anchor:none]">
      <button type="button" onClick={onClick} disabled={isPending} className={COMPACT_ACTION_LINK_CLASS}>
        {isPending
          ? "読み込み中…"
          : failed
            ? "続きを読み込めませんでした。押してもう一度"
            : `さらに表示 (残り ${remaining} 件)`}
      </button>
    </div>
  );
}

// 塊が画面に入ったら、入っている中で最後のページまでを読む。見えている枠は
// すぐ、1 画面先は解禁 (armed) の後だけ。塊が入れ替わる (ページが届く) たびに
// 張り直す — 張り直した直後の通知で、まだ見えている枠を続けて埋める
function useWatchChunks(
  ref: RefObject<HTMLDivElement | null>,
  { key, armed, enabled, mode, load }: { key: string; armed: boolean; enabled: boolean; mode: string; load: (page: number) => void },
) {
  useEffect(() => {
    const el = ref.current;
    if (el === null || !enabled) return;
    const observers: IntersectionObserver[] = [];
    const cancel = afterNextPaint(() => {
      const root = scrollRootOf(el);
      const targets = [...el.querySelectorAll<HTMLElement>("[data-placeholder-page]")];
      const watch = (rootMargin: string) => {
        const visible = new Set<number>();
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const page = Number((entry.target as HTMLElement).dataset.placeholderPage);
              if (entry.isIntersecting) visible.add(page);
              else visible.delete(page);
            }
            const last = lastVisiblePage(visible);
            if (last !== null) load(last);
          },
          { root, rootMargin },
        );
        targets.forEach((target) => observer.observe(target));
        observers.push(observer);
      };
      watch("0px");
      if (armed) watch(PREFETCH_MARGIN);
    });
    return () => {
      cancel();
      observers.forEach((observer) => observer.disconnect());
    };
    // mode … 構成でスクロールする器が替わる。key … 塊が入れ替わった
  }, [ref, key, armed, enabled, mode, load]);
}

// 1 ページぶんの枠。中身は無く、行と同じ高さの箱を並べるだけ
const ChunkFrames = memo(function ChunkFrames({ chunk, view }: { chunk: PlaceholderChunk; view: ViewMode }) {
  const height = PLACEHOLDER_HEIGHT[view];
  const frames = Array.from({ length: chunk.count }, (_, i) => i);
  if (view === "image") {
    return (
      <div
        data-placeholder-page={chunk.page}
        aria-hidden="true"
        className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-1"
      >
        {frames.map((i) => (
          <div key={i} style={{ height }} className="rounded bg-gray-100" />
        ))}
      </div>
    );
  }
  return (
    <ul data-placeholder-page={chunk.page} aria-hidden="true" className={listClassOf(view)}>
      {frames.map((i) => (
        <li key={i} style={{ height }} className={view === "card" ? "rounded border border-gray-200 bg-gray-50" : "bg-gray-50"} />
      ))}
    </ul>
  );
});

// 最初の 1 ページが届く前に出す枠 (中身なし)。件数がまだ判らないので 1 画面ぶん
export const INITIAL_PLACEHOLDER_COUNT = 12;

export function InitialPlaceholders({ view }: { view: ViewMode }) {
  return <ChunkFrames chunk={{ page: 0, count: INITIAL_PLACEHOLDER_COUNT }} view={view} />;
}
