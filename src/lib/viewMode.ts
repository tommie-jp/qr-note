// 検索結果の表示モード (docs/23-検索結果表示モード計画.md §1)。
//
//   compact (小) … 1 カラム。**1 ノート 1 行** (#番号 + タイトル) + 1 行ぶんの
//                  サムネ。番号や見出しを拾うためのいちばん密な表示で、
//                  タグは出さない (タグは中・大とノート本体で見る)。
//   medium  (中) … 1 カラム。1 ノート 2 行 (タイトル / タグ) + 小さなサムネ。
//                  タグまで見ながら眺めるための表示。
//   card    (大) … タイトル / タグ / 本文 3 行 + 大きめのサムネ。
//                  カラム数は画面幅が決める (スマホ 1 列 / PC 2 列以上)。
//   image (画像) … 本文に貼られた画像だけを masonry で敷き詰める
//                  (docs/32-画像表示モード計画.md)。写真からノートを探す入口。
//
// **URL ではなく cookie に持つ**。ページ番号は「何を見ているか」なので URL が正
// (docs/11-アプリ的UIUX計画.md §3) だが、表示モードは「どう見たいか」という
// 端末ごとの好みで、検索状態ではない。URL だけに置くと:
//   - 共有したリンクに自分の好みが漏れ、相手の好みを上書きしてしまう
//   - スキャンやタグリンクで入るたびに既定へ戻る
//   - buildSearchUrl の呼び出し全部に引数が増える
// cookie ならサーバコンポーネントが描画前に読めるので、初回描画から正しい
// レイアウトで出る (localStorage だと一度描いてから跳ねる)。
//
// **並び順 (sort) も後から cookie を併用するようになった** (src/lib/sortMode.ts)。
// 当初は「並び順は何を見ているか」として URL 一本だったが、上の 2 つ目の理由
// (入るたびに既定へ戻る) が実際に起きたため。あちらは URL があればそちらを
// 優先する二段構えで、ここ (表示モード) は cookie だけ — 表示モードは
// 共有リンクで指定したいものではないので、URL に出す理由がない。

export type ViewMode = 'compact' | 'medium' | 'card' | 'image'

export const VIEW_MODE_COOKIE = 'view'

// 未設定・不正値のときの既定。今までの見た目 (2 行の一覧) を既定にすることで、
// この機能が入っても何もしていない人の画面は変わらない。
// satisfies … 型注釈だと 'compact' が ViewMode に広がり、compact/card しか
// 受けない ItemRow の既定値に使えなくなる。リテラル型のまま整合だけ検査する
export const DEFAULT_VIEW_MODE = 'compact' satisfies ViewMode

// 妥当なモードをすべて並べた表。**この並びがそのまま UI の順になる** —
// 下部バーの短いタップの循環 (小 → 大 → 画像) と長押しメニューの上下を、
// どちらも cycleOf でここから作る (SORTS と lib/sortDirection.ts の関係と同じ)。
export const VIEW_MODES: readonly ViewMode[] = [
  'compact',
  'medium',
  'card',
  'image',
]

// 器を画面いっぱいに広げる表示か (docs/23 §1, docs/32 §1)。
// カードと画像は列を増やしたいので広げ、1 カラムの小・中は読み幅を保つ。
// **判定をここに置く**のが要点 — 検索とゴミ箱の 2 か所で同じ式を書くと、
// 表示を足した日に片方だけ広いままになる
export function usesWideResults(view: ViewMode): boolean {
  return view === 'card' || view === 'image'
}

// cookie は利用者が自由に書き換えられる外部入力なので、素通しせず畳む
// (parseSort と同じ流儀)。
export function parseViewMode(value: unknown): ViewMode {
  return VIEW_MODES.includes(value as ViewMode)
    ? (value as ViewMode)
    : DEFAULT_VIEW_MODE
}

// cookie の寿命 (秒)。1 年。好みなので、次に自分で変えるまで続くのが期待どおり。
export const VIEW_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
