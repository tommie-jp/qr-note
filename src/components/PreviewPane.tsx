"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ClearIcon } from "@/components/MenuIcons";
import { PaneResizer } from "@/components/PaneResizer";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { itemNoFromPathname } from "@/lib/searchUrl";

interface PreviewPaneProps {
  // ペインの地色。本番=灰 / ローカル=ピンクは env から決まるので、サーバ側
  // (@detail の page.tsx) が決めて渡す。LOCAL の目印はプレビューでも失わない
  bgClass: string;
  // 「全画面で開く」の行き先。**意図的に <a> のハード遷移** (docs/86 §3) —
  // Link のソフト遷移は横取りされてこのペインへ戻ってきてしまう。ハードで
  // /item に着いたときだけ RecordAccess が働き、accessedAt が進む。
  // loading (器だけ先に出す) では番号がまだ判らないので任意
  openHref?: string;
  children: ReactNode;
}

// 検索 3 ペインの右下、選択したノートの器 (docs/86 §4)。
//
// 中身 (ItemView) は @detail の page.tsx が入れる。器の畳み方は画面幅で変える:
//
//   lg 未満 … 全画面のオーバーレイ (z-30 でヘッダーごと覆う)。横取りは
//             画面幅では止められないので、狭い画面では「ペイン」ではなく
//             「従来の画面遷移と同じ見た目」として描く。
//   lg 以上 … 画面下部に固定し、中で独立にスクロールする。高さは
//             --preview-pane-h (globals.css)。一覧の底上げ padding と
//             必ず同じ変数で動かす。
export function PreviewPane({ bgClass, openHref, children }: PreviewPaneProps) {
  const router = useRouter();
  const pathname = usePathname();

  // 「URL が正」(docs/11 §3) をペインにも通す: /item/<番号> に居ないなら
  // 描かない (判定は ItemList の行ハイライトと同じ itemNoFromPathname)。
  // スロットの中身は「合わない URL へのソフト遷移では残る」仕様なので
  // (docs/86 §2)、ロゴや「一覧へ」で / に戻ったときに放っておくと
  // オーバーレイが画面を覆ったまま残ってしまう。ページ送り (replace) で
  // ペインが閉じるのはこの割り切りの裏面 — 選択が URL から消えた以上、
  // 出し続けるほうが嘘になる。
  //
  // Esc で閉じる、はあえて持たない。モーダル類 (draw・スキャナ・検索
  // パネル…) がそれぞれ自前の Esc を持つ流儀で、ペインが window で先に
  // 拾うと開いているモーダルより先に画面ごと閉じてしまう
  if (itemNoFromPathname(pathname) === null) {
    return null;
  }

  return (
    <>
      {/* 上端の境界をドラッグして高さを変える (docs/86 §4-2)。帯は z-20 で
          ペイン (lg 以上では z-10) の上に出る。lg 未満は全画面オーバーレイ
          なので帯そのものを出さない (PaneResizer の hidden lg:block) */}
      <PaneResizer kind="preview" />
      {/* data-preview-pane … 一覧 (main) の底上げ padding のフック
          (globals.css の body:has)。lg 未満のオーバーレイは z-30 でヘッダー
          (z-20)・下部バー (z-10) ごと覆う。lg 以上は z-10 に落として下部バーと
          同層に並べ、バーの高さ (--bottom-bar-h) だけ上で止めて、
          スキャン等のボタンを塞がない */}
      <section
        data-preview-pane
        aria-label="選択したノート"
        className={`fixed inset-0 z-30 overflow-y-auto overscroll-contain ${bgClass} lg:top-auto lg:bottom-[var(--bottom-bar-h)] lg:z-10 lg:h-[var(--preview-pane-h)] lg:border-t lg:border-gray-300 xl:left-[var(--folder-pane-w)]`}
      >
        {/* 操作行は深くスクロールしても届くよう貼り付ける。地色を重ねるのは
            下を通る本文を透けさせないため。z-10 … 本文側の relative z-10
            (タグ・補助行) より DOM 順で後にはならないので、同層にして
            sticky 側を上に出す */}
        <div className={`sticky top-0 z-10 ${bgClass}`}>
          <div className="mx-auto flex max-w-2xl items-center justify-between px-safe pt-safe landscape-phone:max-w-4xl">
            <button
              type="button"
              onClick={() => router.back()}
              className={ACTION_LINK_CLASS}
            >
              <ClearIcon />
              閉じる
            </button>
            {openHref && (
              <a href={openHref} className={ACTION_LINK_CLASS}>
                全画面で開く
              </a>
            )}
          </div>
        </div>
        {/* pb-safe … lg 未満の全画面ではホームバーに潜らせない。
            lg:pb-20 … ペインの下端は下部バーの上で終わるが、テキストサイズ
            設定でバーが伸びた分やスクロールの余韻も考えて広めに取る */}
        <div className="mx-auto max-w-2xl px-safe pb-safe landscape-phone:max-w-4xl lg:pb-20">
          {children}
        </div>
      </section>
    </>
  );
}
