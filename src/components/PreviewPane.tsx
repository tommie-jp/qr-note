"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ClearIcon } from "@/components/MenuIcons";
import { PaneResizer } from "@/components/PaneResizer";
import { usePaneMode } from "@/components/PaneModeProvider";
import { ACTION_LINK_CLASS } from "@/components/ui";
import {
  keepsNoteOpen,
  notePaneLayout,
  type NotePaneLayout,
} from "@/lib/paneMode";
import { itemNoFromPathname } from "@/lib/searchUrl";

// 器の置き方。**z の高さが要点** (docs/86 §4-9):
//   下部ペイン … z-0。下部バー (z-10) より下に置く — 長押しメニューは
//     バーの上へせり上がるので、ペインと同層だと DOM 順で負けて隠れる。
//   全画面 … z-10。バーごと覆う (ノートを読む間は検索の帯を出さない)。
// どちらもヘッダー (z-20) の下から始める (§4-5)。
const PANE_BOX_CLASS: Record<NotePaneLayout, string> = {
  pane: "top-auto bottom-[var(--bottom-bar-h)] z-0 h-[var(--preview-pane-h)]",
  "pane-lg":
    "top-[var(--header-h)] bottom-0 z-10 lg:top-auto lg:bottom-[var(--bottom-bar-h)] lg:z-0 lg:h-[var(--preview-pane-h)]",
  fullscreen: "top-[var(--header-h)] bottom-0 z-10",
};

// ペインとして出ているときは幅いっぱいに使う (docs/86 §4-8)。全画面では
// 読み幅に収めたまま — 画面の端から端まで続く行は目で追えない
const PANE_WIDTH_CLASS: Record<NotePaneLayout, string> = {
  pane: "max-w-none",
  "pane-lg": "lg:max-w-none",
  fullscreen: "",
};

interface PreviewPaneProps {
  // ペインの地色。本番=灰 / ローカル=ピンクは env から決まるので、サーバ側
  // (@detail の page.tsx) が決めて渡す。LOCAL の目印はプレビューでも失わない
  bgClass: string;
  // 出しているノートの番号。一覧のハイライトのために context へ知らせる
  // (docs/86 §4-4)。骨組み (loading) では番号がまだ判らないので任意
  itemNo?: string;
  // このペインの出どころ。
  //   detail … /item へのソフト遷移を横取りしたスロット (@detail)。
  //   auto   … 3 ペインで「先頭のノートを自動で選ぶ」ペイン (検索ページ側)。
  // 3 ペインで URL が /item から離れても閉じないのは detail だけ —
  // auto は検索のたびに先頭が変わるので、URL から離れた瞬間に用が済む
  source?: "detail" | "auto";
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
export function PreviewPane({
  bgClass,
  itemNo,
  source = "detail",
  openHref,
  children,
}: PreviewPaneProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { mode, setDetailItemNo, setAutoItemNo } = usePaneMode();

  // 「URL が正」(docs/11 §3) をペインにも通す: /item/<番号> に居ないなら
  // 描かない (判定は itemNoFromPathname で一覧のハイライトと共有)。
  // スロットの中身は「合わない URL へのソフト遷移では残る」仕様なので
  // (docs/86 §2)、ロゴや「一覧へ」で / に戻ったときに放っておくと
  // オーバーレイが画面を覆ったまま残ってしまう。
  //
  // **例外が 3 ペイン (docs/86 §4-4)。** あちらはノートも常設の面なので、
  // 検索語を打ち替えてもページを送っても閉じない。閉じるのは自動ではなく
  // 「閉じる」を押したとき (= 2 / 1 ペインへ切り替えたとき) だけ。
  // 自動で選んだ側 (auto) はこの例外に入らない — 検索が変われば先頭も
  // 変わるので、その URL から離れた時点で用が済んでいる。
  //
  // Esc で閉じる、はあえて持たない。モーダル類 (draw・スキャナ・検索
  // パネル…) がそれぞれ自前の Esc を持つ流儀で、ペインが window で先に
  // 拾うと開いているモーダルより先に画面ごと閉じてしまう
  // 自動で選んだ側 (auto) は URL を見ない — /item に居ないときの代わりとして
  // 置かれる物なので、URL で判定したら永久に出ない。出す / 引っ込めるは
  // 呼び手 (AutoNotePane) が構成と横取りの有無で決めている
  const onItemUrl = itemNoFromPathname(pathname) !== null;
  const keepOpen = source === "detail" && keepsNoteOpen(mode);
  const visible = source === "auto" || onItemUrl || keepOpen;

  // 2 ペインの狭い画面 (ノートが全画面になる幅) では、出しっぱなしにしない。
  // 全画面のまま居座ると一覧が覆われて戻れなくなる (docs/86 §4-9)。
  // 3 ペインは幅に関係なく下部のペインなので、この逃げ道は要らない
  const keptOpenOffUrl = !onItemUrl && (keepOpen || source === "auto");

  // 一覧の行・画像タイルのハイライトはこの番号を見る (docs/86 §4-4)。
  // pathname から決めないのは、3 ペインでは URL が /item から離れても
  // ノートが出たままになるため。**出していない間は null を流す** —
  // 閉じたのに行だけ選ばれたまま、にしない
  const shown = visible && itemNo !== undefined ? itemNo : null;
  useEffect(() => {
    if (source === "detail") {
      setDetailItemNo(shown);
    } else {
      setAutoItemNo(shown);
    }
  }, [shown, source, setDetailItemNo, setAutoItemNo]);

  if (!visible) {
    return null;
  }

  // 器の畳み方は構成が決める (docs/86 §4-9)。3 ペインは幅に関係なくペイン、
  // 2 ペインは lg 以上だけペイン、1 ペインは常に全画面
  const layout = notePaneLayout(mode);
  const isBottomPane = layout !== "fullscreen";

  return (
    <>
      {/* 上端の境界をドラッグして高さを変える (docs/86 §4-2)。帯は z-20 で
          ペイン (lg 以上では z-10) の上に出る。lg 未満は全画面オーバーレイ
          なので帯そのものを出さない (PaneResizer の hidden lg:block) */}
      {isBottomPane && (
        <PaneResizer kind="preview" atAnyWidth={layout === "pane"} />
      )}
      {/* data-preview-pane … 一覧 (main) の底を上げるフック (globals.css の
          body:has)。**下部ペインのときだけ付ける** — 全画面のときに付けると、
          隠れている一覧が意味もなく縮む。
          **ヘッダーは覆わない** (docs/86 §4-5)。1 ペインや狭い画面ではノートが
          画面いっぱいに広がるが、上端は必ずヘッダーの下 (--header-h) から。
          メニュー・ホーム・ペイン構成は、ノートを開いている間も押せる必要が
          ある。z-10 … 万一ヘッダーが伸びても、ヘッダー (z-20) が上に残る。
          lg 以上の下部ペインは下部バーの高さ (--bottom-bar-h) だけ上で止めて、
          スキャン等のボタンを塞がない */}
      <section
        data-preview-pane={isBottomPane ? "" : undefined}
        aria-label="選択したノート"
        // 左端をフォルダーペインの右へ寄せるのは globals.css の仕事
        // (ペインが出ている構成のときだけ効かせたいので :has で見る)
        className={`fixed inset-x-0 overflow-y-auto overscroll-contain ${bgClass} ${
          PANE_BOX_CLASS[layout]
        } ${keptOpenOffUrl && layout === "pane-lg" ? "max-lg:hidden" : ""}`}
      >
        {/* 操作行は深くスクロールしても届くよう貼り付ける。地色を重ねるのは
            下を通る本文を透けさせないため。z-10 … 本文側の relative z-10
            (タグ・補助行) より DOM 順で後にはならないので、同層にして
            sticky 側を上に出す */}
        <div className={`sticky top-0 z-10 ${bgClass}`}>
          <div
            className={`mx-auto flex max-w-2xl items-center justify-between px-safe pt-safe landscape-phone:max-w-4xl ${PANE_WIDTH_CLASS[layout]}`}
          >
            {/* 「閉じる」は**閉じられるときだけ**出す (docs/86 §4-4)。
                ペインとして常設されている間は押しても閉じられないので、
                ボタンにすると嘘になる (畳みたいときはヘッダーの構成を変える)。
                2 ペインの狭い画面ではノートが全画面 = 閉じられるので、
                そこだけ CSS で出す。
                空でも要素は置く — justify-between の右端 (全画面で開く) が
                左へ寄ってしまうため */}
            {layout === "pane" ? (
              <span />
            ) : (
              <button
                type="button"
                onClick={() => router.back()}
                className={`${ACTION_LINK_CLASS} ${
                  layout === "pane-lg" ? "lg:hidden" : ""
                }`}
              >
                <ClearIcon />
                閉じる
              </button>
            )}
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
        {/* ペインのときは幅いっぱいに使う (docs/86 §4-8)。全画面 (1 ペイン・
            狭い画面) では今までどおり読み幅に収める — 画面の端から端まで
            続く行は目で追えない */}
        <div
          className={`mx-auto max-w-2xl px-safe pb-safe landscape-phone:max-w-4xl lg:pb-20 ${PANE_WIDTH_CLASS[layout]}`}
        >
          {children}
        </div>
      </section>
    </>
  );
}
