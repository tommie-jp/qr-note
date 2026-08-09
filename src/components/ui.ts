// ページ間で共有する枠・入力欄・ボタンの Tailwind クラス。
// メモの markdown 表示 / テキスト表示 / 入力欄で見た目を揃える

// 枠と余白を分けて持つ。検索画面の詰めた入力欄 (COMPACT_INPUT_CLASS) が
// 縦の余白だけ差し替えられるようにするため。py-1 を後ろから足す形にすると、
// Tailwind は「クラス属性の並び順」ではなく「CSS 内の定義順」で勝敗が決まり、
// py-2 が勝ってしまう
const BOX_SKIN = "rounded border border-gray-300 bg-white px-3";

export const BOX_CLASS = `${BOX_SKIN} py-2`;

export const MEMO_INPUT_CLASS = `w-full ${BOX_CLASS} font-mono text-base`;

// 以下、押した感とタップ領域のための共有クラス (docs/11-アプリ的UIUX計画.md §1-4)。
// min-h-11 = 44px は指で狙える最小の大きさ。active: で押した瞬間に反応を返す
// (サーバ応答を待つ間、無反応に見えるのを防ぐ)

// 見た目 (色・枠・押した感) と大きさ (高さ・余白・文字) を分けて持つ。
// 検索画面だけを詰めた版に差し替えるため (COMPACT_* 参照)
const PRIMARY_SKIN =
  "inline-flex items-center justify-center gap-2 rounded bg-blue-600 font-medium text-white transition-transform active:scale-95 disabled:opacity-60 disabled:active:scale-100";
const SECONDARY_SKIN =
  "inline-flex items-center justify-center gap-2 rounded border border-gray-300 bg-white font-medium text-gray-700 transition active:scale-95 active:bg-gray-100 disabled:opacity-50 disabled:active:scale-100";
const ACTION_LINK_SKIN =
  "inline-flex items-center gap-1.5 rounded text-blue-600 transition-colors active:bg-blue-50";

// 主ボタン (更新など)
export const PRIMARY_BUTTON_CLASS = `${PRIMARY_SKIN} min-h-11 px-6`;

// 副ボタン (スキャン・画像挿入など)
export const SECONDARY_BUTTON_CLASS = `${SECONDARY_SKIN} min-h-11 px-3`;

// 操作リンク (編集 / QR / 記法 / ページ送りなど)。素の下線リンクは指で狙いにくい
export const ACTION_LINK_CLASS = `${ACTION_LINK_SKIN} min-h-11 px-2`;

// 以下、**検索画面トップ専用**の詰めた版 (高さ 36px / 文字 14px)。
//
// 一覧は「並んだ物を見比べる」画面で、操作ボタンは主役ではない。44px の
// 押しやすさより 1 画面に入る件数を優先する。逆に編集画面などは「狙って
// 押す」場所なので 44px のまま — だから共有クラスを縮めず別に切っている。
// 使う場所は SearchForm / ItemList / (search)/page.tsx だけ
const COMPACT_SIZE = "min-h-9 text-sm";

export const COMPACT_SECONDARY_BUTTON_CLASS = `${SECONDARY_SKIN} ${COMPACT_SIZE} px-3`;

export const COMPACT_ACTION_LINK_CLASS = `${ACTION_LINK_SKIN} ${COMPACT_SIZE} px-2`;

// アイコンだけのボタン (検索窓の行の「+」)。左右の余白を持たず高さと同じ幅の
// 正方形にする。px-3 のままだと 1 つの図形に対して枠が横長になり、間延びして見える
export const COMPACT_ICON_BUTTON_CLASS = `${SECONDARY_SKIN} min-h-9 w-9`;

// 同じ寸法の主ボタン版 (検索窓の行の虫眼鏡)。文字を持たないので px は要らない
export const COMPACT_PRIMARY_ICON_BUTTON_CLASS = `${PRIMARY_SKIN} min-h-9 w-9`;

// 本文の上に重ねる小さいボタン (コードブロックのコピー)。
// 44px を割るのは、本文の一部を覆う道具だから — 大きくすると読みたい行を
// 隠してしまう。狙って押す場所ではなく、押し損ねても実害がない
export const OVERLAY_BUTTON_CLASS = `${SECONDARY_SKIN} px-2 py-1 text-xs`;

// 検索窓。文字だけは text-base (16px) のまま下げない。iOS Safari は 16px 未満の
// 入力欄にフォーカスすると画面を勝手に拡大し、戻せないため
export const COMPACT_INPUT_CLASS = `${BOX_SKIN} min-h-9 py-1`;

// 時間のかかる準備・処理中の知らせ (OCR、画像検索のモデル準備、書誌取得など)。
// 灰色の小さな文字だと埋もれて「固まった」と誤解されるため、赤背景で統一して
// 目立たせる。置き場所ごとのレイアウト (flex / absolute) は使う側で足す
export const BUSY_NOTICE_CLASS =
  "rounded bg-red-600/90 px-3 py-2 font-medium text-white";

// BUSY_NOTICE_CLASS の中に置くスピナー (赤背景に合わせた白系)
export const BUSY_SPINNER_CLASS =
  "size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white";

// ヘッダーのハンバーガーメニューの 1 行 (docs/11-アプリ的UIUX計画.md §6)。
//
// 行そのものをタップ領域にする (w-full + min-h-11)。文字だけを的にすると、
// メニューという「狙って押す場所」で指を外しやすい。
// リンクもボタンも同じ見た目にするため、両方からこれを使う。
//
// gap-2 は行頭のアイコン (MenuIcons.tsx) との間隔。高さは 44px のまま —
// メニューは「狙って押す」場所なので、検索画面のように詰めない
// 押せない行 (中に自前のボタンを持つ TextSizeMenuItem など) はこちらを使う。
// 押せる行と寸法だけを共有し、押した感じの色は持たない — 行のどこを押しても
// 何も起きないのに反応が返ると、押し損ねたように見えるため
export const HEADER_MENU_ROW_CLASS =
  "flex min-h-11 w-full items-center gap-2 rounded px-3 text-left font-medium text-gray-700";

export const HEADER_MENU_ITEM_CLASS = `${HEADER_MENU_ROW_CLASS} transition-colors hover:bg-gray-100 active:bg-gray-200`;

// 破壊的な操作 (ゴミ箱へ / 永久削除)。赤は「戻せないかもしれない」の合図で、
// 押す前に一拍置かせる。枠は持たせない (主ボタンと同格に見せない)
export const DANGER_BUTTON_CLASS =
  "inline-flex min-h-11 items-center justify-center gap-1 rounded px-3 font-medium text-red-700 transition-colors hover:bg-red-50 active:bg-red-100 disabled:opacity-50 disabled:hover:bg-transparent";

// カード表示のとき、検索結果エリアだけを画面の広い側へはみ出させる
// (docs/23-検索結果表示モード計画.md §1)。
//
// アプリの器は main の max-w-2xl (672px) で、これはメモの本文が読める行長に
// 収めるための意図的な設計。だがカードのグリッドはその制約の対象ではなく、
// 672px のままだと 320px 幅のカードが 2 つ入らず、PC でも永久に 1 カラムになる
// (実測: ul は 640px で、2 カラムに 8px 足りない)。
//
// 仕組み: left-1/2 で親の中心まで送り、-translate-x-1/2 で自分の幅の半分だけ
// 戻す。親と自分の幅を知らなくても中心が揃うので、main の幅を変えても壊れない。
//
// 100vw ではなく calc(100vw-4rem) なのは、100vw が縦スクロールバーの幅を含み、
// そのままだと横スクロールバーが出るため。4rem の余白がそれを吸収する。
//
// lg: 以上に限るのは、狭い画面でこれをやる意味がないから。スマホは元から
// 1 カラムで、はみ出させる余白も無い
export const WIDE_RESULTS_CLASS =
  "lg:relative lg:left-1/2 lg:w-[calc(100vw-4rem)] lg:max-w-6xl lg:-translate-x-1/2";

// 検索画面の下部操作バー (docs/31-下部操作バー計画.md §4)。
//
// fixed で画面下端に貼り付ける。中身はヘッダーと同じ max-w-2xl に収め、
// 広い画面でボタンが左右に散らばらないようにする。
// 下端の余白は自前で持つ (HeaderMenu のボトムシートと同じ。standalone の
// ホームバーに潜らせない)。
//
// z-10 … ハンバーガーメニューの外側タップ用の覆い (z-10) と同層に置き、
// DOM 順で覆いを勝たせる。バーが覆いより上だと、メニューを開いたまま
// バーが押せてしまう (docs/11 §8-4 の落とし穴 3 と同じ罠)
//
// select-none / touch-callout … バーは「押す物」だけが並ぶ帯で、文字を
// 読んで持ち出す場所ではない。既定のままだと、指を置いたとたんにラベルが
// 青く反転し、iOS では「コピー / 調べる」の吹き出しが出る。長押しを
// メニューに使う (docs/62-下部バー長押し計画.md) なら、これが毎回かぶる
export const BOTTOM_BAR_CLASS =
  "fixed inset-x-0 bottom-0 z-10 select-none border-t backdrop-blur [-webkit-touch-callout:none] print:hidden";

// landscape-phone:max-w-4xl … スマホ横持ちでは main と同じく 672px の上限を
// 緩め、スロットを全幅に広げる (docs/31 §12-4)
// bottom-bar-scale-cap … テキストサイズ (docs/61) の倍率をここだけ 130% で
// 頭打ちにする。5 スロットを必ず横に並べる帯なので、他と同じだけ大きくすると
// 175% で画面幅に入らず、右端のスロットが画面の外へ出る (globals.css に詳細)
const BOTTOM_BAR_INNER_BASE =
  "bottom-bar-scale-cap mx-auto flex items-stretch px-safe pb-[max(0.25rem,env(safe-area-inset-bottom))]";

export const BOTTOM_BAR_INNER_CLASS = `${BOTTOM_BAR_INNER_BASE} max-w-2xl landscape-phone:max-w-4xl`;

// スロットが少ない画面 (ゴミ箱は表示・並び順の 2 つだけ。
// docs/67-ゴミ箱表示形式計画.md §4) の内側。
//
// スロットは flex-1 で器を等分するので、max-w-2xl のままだと 2 つが画面幅の
// 半分ずつを占める。押す的が大きすぎて「バーいっぱいの 2 択」に見え、
// 検索画面の同じスロットとも別物に見えてしまう。器のほうを絞って、
// スロットの幅を 5 つ並べたときと揃える。
export const BOTTOM_BAR_INNER_NARROW_CLASS = `${BOTTOM_BAR_INNER_BASE} max-w-xs`;

// バーの 1 スロット。5 等分 (flex-1) して 320px でも 64px を確保する。
// 高さ 44px 以上 … バーは「狙って押す」場所なので、検索画面の他の操作
// (COMPACT_* の 36px) のようには詰めない (docs/31 §3-3)。
//
// landscape-phone: … スマホ横持ちでは縦積み (アイコンの下にラベル) をやめ、
// アイコンとラベルを横に並べて高さを 52px → 36px に詰める (docs/31 §12)。
// 視界の高さが 300px 台まで減るので、縦幅の節約を 44px より優先する
// (iOS のタブバーが横向きでコンパクト形へ変わるのと同じ作法)
export const BOTTOM_BAR_SLOT_CLASS =
  "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded px-1 pt-1.5 text-[0.625rem] font-medium leading-none transition-colors active:bg-gray-200/70 landscape-phone:min-h-9 landscape-phone:flex-row landscape-phone:gap-1.5 landscape-phone:pt-0 landscape-phone:text-xs";

// バーぶんの余白。これがないと一覧の最終行とページ送りがバーに隠れる。
// 高さ = アイコン 24 + 隙間 + ラベル + 上下余白 ≒ 3.25rem。
// landscape-phone はスロットが min-h-9 (36px) + 下余白 4px ≒ 2.5rem
// バーと同じ上限を掛ける。掛けないと、バーの高さが 130% で止まった後も
// ここだけ伸び続け、一覧の下に使われない空白が残る
export const BOTTOM_BAR_SPACER_CLASS =
  "bottom-bar-scale-cap h-[calc(3.25rem+env(safe-area-inset-bottom))] print:hidden landscape-phone:h-[calc(2.5rem+env(safe-area-inset-bottom))]";

// 下部バーのスロットを長押ししたとき出るメニューの 1 行
// (docs/62-下部バー長押し計画.md §3)。
//
// 高さは 44px のまま。バーのスロット自体を 44px にした理由 (狙って押す場所)
// はメニューにもそのまま当てはまり、むしろ選択肢が縦に近接するぶん
// 押し間違いの余地が大きい。文字はバーのラベル (0.625rem) ではなく text-sm —
// メニューは一覧の密度と競合しないので、詰める理由がない
export const SLOT_MENU_ITEM_CLASS =
  "flex min-h-11 w-full items-center gap-2 whitespace-nowrap px-3 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 active:bg-gray-200";

// 行アクションのメニュー項目 (docs/66-行アクション計画.md §5-3)。
//
// **こちらは文字を出さずアイコンだけ**にする。下部バーのメニューは 3 つの値の
// うちどれを選ぶかを読む場所なので文字が要るが、行アクションは操作が並ぶだけで、
// 指のすぐ上に出る小さな的に文字まで載せると横に広がって行を覆う。名前は
// aria-label で言う (伏せているのは絵の説明であって、意味ではない)。
//
// 色は使う側から与える。**色抜きで分けるのが要点** — 土台に text-gray-700 を
// 残したまま使う側で text-red-700 を足すと、どちらが勝つかは class 属性の
// 並び順ではなく生成された CSS の並び順で決まる (同じ詳細度の同族
// ユーティリティ)。効いたり効かなかったりする指定になる。
//
// 44px 角。文字が無いぶん的が細くなるので、幅の下限も高さと同じだけ取る
const ROW_MENU_ICON_ITEM_SKIN =
  "flex min-h-11 min-w-11 items-center justify-center transition-colors";

export const ROW_MENU_ICON_ITEM_CLASS = `${ROW_MENU_ICON_ITEM_SKIN} text-gray-700 hover:bg-gray-100 active:bg-gray-200`;

// 取り返しの付きにくい操作 (ゴミ箱へ移動)。押下の地色も赤系に合わせる
export const ROW_MENU_ICON_ITEM_DANGER_CLASS = `${ROW_MENU_ICON_ITEM_SKIN} text-red-700 hover:bg-red-50 active:bg-red-100`;
