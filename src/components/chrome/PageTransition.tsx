import type { ReactNode } from "react";
import { ViewTransition } from "react";

// ページ本体を包んで画面遷移に前後の向きを付ける (docs/11-アプリ的UIUX計画.md §4)。
//
// layout ではなくページごとに置く。layout の要素は遷移しても unmount されず、
// enter / exit が起きないため (実測: layout に置くと startViewTransition が
// 一度も呼ばれない)。
//
// ページ単位なので、検索で searchParams だけが変わる遷移では動かない
// (ページの要素は残るため)。打つたびに一覧がスライドしないので都合がよい。
//
// default="none" … 種類の付かない遷移 (初回表示・ブラウザの戻る) では動かさない。
// 種類は Link の transitionTypes で渡す: 深く入るリンクが nav-forward、
// 戻るリンク (表示へ・一覧へ・タグ) が nav-back。
// 非対応ブラウザではアニメーションなしで普通に切り替わる。
const ENTER_EXIT = {
  "nav-forward": "nav-forward",
  "nav-back": "nav-back",
  default: "none",
} as const;

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition default="none" enter={ENTER_EXIT} exit={ENTER_EXIT}>
      {children}
    </ViewTransition>
  );
}
