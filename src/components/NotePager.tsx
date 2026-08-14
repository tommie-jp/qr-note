"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PageNextIcon, PagePrevIcon } from "@/components/MenuIcons";
import { PressTip } from "@/components/PressTip";
import { COMPACT_ICON_BUTTON_CLASS } from "@/components/ui";
import { useNotePagerPaged } from "@/lib/notePagerPref";

// ノートのページ送り (docs/74-ページ計画.md §4)。
//
// 本文を描くのはサーバのまま。`MemoPanel` と同じく**描き終わった ReactNode を
// slot で受け取り**、いま何ページ目かだけをここが持つ (react-markdown / KaTeX を
// client 束へ引き込まないため)。
//
// 隠したページも DOM には置く。ブラウザのページ内検索が全ページに効き、
// 印刷では全ページが紙に出る。mermaid は body の一時要素で描かれるので
// (mermaidRender.ts)、隠れた枠の中でも図が壊れることはない。
//
// **ページ送りをやめて通しで読むこともできる** (docs/82 §3)。切り替えるのは
// 見出し行のボタン (NotePageModeToggle) で、設定の正本は localStorage
// (lib/notePagerPref.ts) — 間に Server Component が挟まるので props では
// 繋げない。通し表示は「画面が印刷と同じ積み方になる」だけ — 枠も定義の
// 配り方もそのままで、隠す class を外して区切りの罫線を戻す。
//
// URL のフラグメントは 2 種類ある。`#p3` は「3 ページ目を開く」指定で、
// それ以外は本文の中のアンカー (脚注の番号・「本文に戻る」・手書きの
// `[x](#id)`) — **後者でページを動かしてはいけない** (pageIndexFromHash /
// anchorPageIndex に経緯)。

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

// フラグメントが指すページ。**#pN 以外は null (ページの指定ではない)。**
//
// 1 ページ目に丸めていた頃は、本文の中のアンカー — 脚注の番号
// (`#user-content-fn-1`)・「本文に戻る」(`#user-content-fnref-1`)・手書きの
// `[x](#id)` — を押すたびに読んでいたページから 1 ページ目へ引き戻され、
// 飛び先は隠れたページの中なので**何も起きないように見えた**
export function pageIndexFromHash(hash: string, count: number): number | null {
  const matched = HASH_PATTERN.exec(hash);
  if (matched === null) {
    return null;
  }
  const page = Number(matched[1]);
  // 範囲外は 1 ページ目に丸める — 共有したリンクの番号が、ページを減らした
  // 後の本文に合わないことがある。開かないより 1 ページ目を出すほうがよい
  return page >= 1 && page <= count ? page - 1 : 0;
}

// アンカーの飛び先が居るページ (hasAnchor は「その枠に飛び先があるか」の並び)。
//
// **開いているページを先に見る。** 脚注の定義は全ページに配ってあるので
// (NoteBody)、同じ id が何ページにも居る — 素直に先頭から探すと、3 ページ目の
// 脚注を押した人が 1 ページ目へ飛ばされる。
//
// どのページにも無ければ null = ページを変えない (ノートの外を指すリンク・
// まだ描かれていない飛び先)
export function anchorPageIndex(
  hasAnchor: readonly boolean[],
  current: number,
): number | null {
  if (hasAnchor[current]) {
    return current;
  }
  const found = hasAnchor.indexOf(true);
  return found === -1 ? null : found;
}

// フラグメントの中身 (`#` を外して %XX を戻したもの)。日本語の id へのリンクは
// %E3.. の形で URL に載る。壊れた %XX (手で書いたリンク) は戻さずそのまま
// 照合する — 指す先が無ければ下の探索が空振りするだけ
function anchorId(hash: string): string {
  const raw = hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// 枠の中で id を持つ要素。**document.getElementById は使えない** — 定義を
// 全ページに配ってある (NoteBody) ので同じ id が何ページにも居て、返るのは
// いつも先頭のページの物になる。
//
// querySelector の `#id` も使わない — 本文に書ける id は CSS の識別子として
// 不正なことがある (数字始まり・記号) ので、id 属性を持つ要素を見て回る
function anchorIn(frame: HTMLElement | null, id: string): HTMLElement | null {
  if (frame === null || id === "") {
    return null;
  }
  for (const element of frame.querySelectorAll<HTMLElement>("[id]")) {
    if (element.id === id) {
      return element;
    }
  }
  return null;
}

// 枠に着せる class。**hidden 属性では隠さない** — それだと印刷でも消える
// (MemoPanel のタブが「開いているタブしか刷れない」のと同じ罠)。
// 通し表示では 1 枚も隠さないので、隠す class ごと付けない
export function pageFrameClass(
  paged: boolean,
  index: number,
  current: number,
): string {
  const hidden = paged && index !== current ? "hidden print:block" : "";
  // 画面のページと紙のページを一致させる (2 ページ目以降は改ページ)
  const breakBefore = index === 0 ? "" : "print:break-before-page";
  // scroll-mt-12 … 通し表示で `#p3` から送られてきたときに、ヘッダー
  // (sticky。layout.tsx) の下へ潜らせない。帯の側と同じ値
  return `scroll-mt-12 ${hidden} ${breakBefore}`;
}

export function NotePager({ pages }: NotePagerProps) {
  const paged = useNotePagerPaged();
  const [index, setIndex] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);
  // 各ページの枠。アンカーの飛び先がどのページに居るかを探すために持つ
  const frameRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 保存でページが減っても、開いていた番号は state に残る (MemoPanel は
  // パネルを unmount しないため)。描く前に丸めないと pages[index] が
  // undefined になって画面ごと落ちる
  const current = Math.min(index, pages.length - 1);

  // フラグメントはサーバに届かない (URL の # から先はリクエストに乗らない)。
  // 初期描画は必ず 1 ページ目で、マウント後にここで合わせる
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash;
      const page = pageIndexFromHash(hash, pages.length);
      if (page !== null) {
        if (!paged) {
          // 通し表示に隠れたページは無いので、開く代わりにそこまで送る。
          // 共有された `#p3` のリンクが「開いても何も起きない」にならないように。
          // ページ送りから切り替えた直後も、読んでいたページの位置に留まれる。
          // 枠には scroll-mt (pageFrameClass) が当ててあるので、start でも
          // sticky なヘッダーの下に潜らない
          requestAnimationFrame(() => {
            frameRefs.current[page]?.scrollIntoView({ block: "start" });
          });
          return;
        }
        setIndex(page);
        return;
      }
      // #pN 以外は本文の中のアンカー (脚注の番号・「本文に戻る」・手書きの
      // `[x](#id)`)。
      //
      // **通し表示では手を出さない。** 隠れたページが無いので、ブラウザの
      // ジャンプは必ず実在する要素に着く — 下の細工はページを開くためのもので、
      // ここでは要らない。定義を全ページに配ってある (NoteBody) ぶん、同じ脚注を
      // 2 ページから参照していると文書順で最初の写しに着くが、着く先は同じ文章で、
      // これは docs/74 §9 で承知した割り切りのまま
      if (!paged) {
        return;
      }
      // ページ送り中は**ページを変えない**のが既定で、飛び先が別のページに
      // 居るときだけそのページを開く
      const id = anchorId(hash);
      if (id === "") {
        return;
      }
      const targets = frameRefs.current.map((frame) => anchorIn(frame, id));
      const found = anchorPageIndex(
        targets.map((target) => target !== null),
        current,
      );
      if (found === null) {
        return;
      }
      setIndex(found);
      // **ブラウザのジャンプには任せられない。** 定義を全ページに配ってある
      // (NoteBody) ので同じ id が何ページにも居て、ブラウザが選ぶのは文書順で
      // 最初の物 = 隠れているページの要素。display:none へはスクロールできず、
      // 押しても何も起きないように見える。
      //
      // 送るのは次の描画の枠で。ページを開き直した直後はまだ display:none で、
      // その場で呼んでも動かない
      requestAnimationFrame(() => {
        // ヘッダーが sticky (layout.tsx) なので start だと帯の下に潜る。
        // 本文の途中の要素に scroll-mt は当てられないため真ん中に置く
        targets[found]?.scrollIntoView({ block: "center" });
      });
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [current, pages.length, paged]);

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

  const currentPage = pages[current];

  return (
    // scroll-mt-12 … ヘッダーが sticky (layout.tsx) なので、そのぶん手前で
    // 止めないとページを送った直後に帯が帯の下へ潜る。rem 指定なので
    // 文字サイズ設定 (docs/61) で root が伸びても一緒に伸びる
    <div className="space-y-2 scroll-mt-12" ref={topRef}>
      {/* 帯は画面だけ。紙では全ページが続けて出るので、押せない前後ボタンを
          刷らない。通し表示では帯ごと出さない — 送る先が無いのに「1 / 3」と
          前後ボタンが居ると、押しても何も起きないボタンになる */}
      {paged && (
        <div className="flex items-center gap-2 print:hidden">
          {/* 前後は文字ではなくアイコン (docs/82 §4)。文字を消したぶん、
              名前は aria-label と長押しの吹き出しが言う。
              disabled の薄さは SECONDARY_SKIN が持つ (COMPACT_ICON_BUTTON_CLASS)
              — 同族の opacity を後から足すと、勝敗はクラスの並び順ではなく
              生成 CSS の並び順で決まって効いたり効かなかったりする */}
          <PressTip label="前のページ">
            <button
              type="button"
              aria-label="前のページ"
              onClick={() => go(current - 1)}
              disabled={current === 0}
              className={COMPACT_ICON_BUTTON_CLASS}
            >
              <PagePrevIcon />
            </button>
          </PressTip>
          <span className="shrink-0 text-sm text-gray-500 tabular-nums">
            {current + 1} / {pages.length}
          </span>
          {/* ページ名は先頭行から作った見出し (notePages.ts)。無題のページも
              あるので、名前の有無で帯の高さが変わらないよう枠は常に置く */}
          <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
            {currentPage.name}
          </span>
          <PressTip label="次のページ">
            <button
              type="button"
              aria-label="次のページ"
              onClick={() => go(current + 1)}
              disabled={current === pages.length - 1}
              className={COMPACT_ICON_BUTTON_CLASS}
            >
              <PageNextIcon />
            </button>
          </PressTip>
        </div>
      )}

      {pages.map((page, i) => (
        <div
          // ページは本文の切れ端で、順番より他に見分ける印が無い
          key={i}
          ref={(element) => {
            frameRefs.current[i] = element;
          }}
          className={pageFrameClass(paged, i, current)}
        >
          {/* 通し表示の継ぎ目。本文に書いた `---` がもともと引いていた線を
              戻すだけ。紙では改ページが継ぎ目なので刷らない */}
          {!paged && i > 0 && (
            <hr className="my-4 border-gray-200 print:hidden" />
          )}
          {page.content}
        </div>
      ))}
    </div>
  );
}
