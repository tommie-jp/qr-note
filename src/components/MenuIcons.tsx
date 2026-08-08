// ハンバーガーメニューの行頭アイコン (docs/11-アプリ的UIUX計画.md §6)。
//
// アイコンライブラリは足さない。必要なのはここの数個だけで、そのために
// 依存とバンドルを増やす釣り合いが取れない (HeaderMenu の ☰ / ✕ を
// inline SVG で持っているのと同じ判断)。
//
// 線は currentColor で描き、色は「アイコン側」で持つ
// (docs/31-下部操作バー計画.md §11-4)。メニューには押下状態による色の反転が
// 無く、使う側が 6 コンポーネントに散っているため、使用側で包むと同じ色指定が
// 散らばる。行ラベルは HEADER_MENU_ITEM_CLASS の gray-700 のままで、
// svg の色指定だけが勝つ。
// 下部バーのアイコン (後半) はこれと逆で、色を使用側から与える — 選択モードで
// 白へ反転する条件分岐が BottomActionBar にあるため (§11-1)。
//
// aria-hidden なのは、隣に必ず同じ意味の文字があるため — 読み上げに
// 「QR コード QR コード」と二重に出さない。

const SIZE_CLASS = "size-5 shrink-0";

// 面になるシェイプに敷く薄い塗り。線 1 色のまま二階調にして、平板な線画より
// 目に留まるようにする (§11-1)。塗り分けに 2 色目を使わないので、
// 色の指定はアイコン 1 個につき 1 つで済む
const TINT = { fill: "currentColor", fillOpacity: 0.15 } as const;

// 線画のアイコンで共通の描き方。塗りではなく線で描くのは、メニューの
// 文字 (font-medium) と線の太さが揃って馴染むため
function StrokeIcon({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className ? `${SIZE_CLASS} ${className}` : SIZE_CLASS}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// QR コード: 位置検出パターン (三隅の四角) が QR の見た目そのもの。
// 細かいセルまでは描かない — 20px では潰れて汚れにしか見えない。
// 色は下部バーの ScanIcon と揃える (同じ QR のモチーフを別物に見せない)
export function QrIcon() {
  return (
    <StrokeIcon className="text-sky-600">
      <rect {...TINT} x="3" y="3" width="7" height="7" rx="1" />
      <rect {...TINT} x="14" y="3" width="7" height="7" rx="1" />
      <rect {...TINT} x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v0M14 20v0M20 20v3M20 17h1" />
    </StrokeIcon>
  );
}

// ログ: 行の並んだ書類。線の長さを不揃いにして「文章が積まれている」形にする
export function LogIcon() {
  return (
    <StrokeIcon className="text-teal-600">
      <path
        {...TINT}
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
      />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </StrokeIcon>
  );
}

// インポート: 箱へ入っていく下向きの矢印。エクスポート (docs/28) を
// 足すときに矢印の向きだけで対にできるモチーフを選ぶ
export function ImportIcon() {
  return (
    <StrokeIcon className="text-amber-600">
      <path {...TINT} d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
    </StrokeIcon>
  );
}

// 履歴取り込み: コミットグラフ (幹と枝)。時計の絵にしないのは「時刻」では
// なく「版の系譜」を指すため (docs/57-ノートgit履歴計画.md §6)
export function HistoryIcon() {
  return (
    <StrokeIcon className="text-orange-600">
      <circle {...TINT} cx="6" cy="6" r="2.5" />
      <circle {...TINT} cx="6" cy="18" r="2.5" />
      <circle {...TINT} cx="18" cy="6" r="2.5" />
      <path d="M6 8.5v7M18 8.5a9.5 9.5 0 0 1-9.5 9.5" />
    </StrokeIcon>
  );
}

// パスキー: 鍵。指紋と迷ったが、20px では指紋の渦が潰れて丸い染みになる
export function KeyIcon() {
  return (
    <StrokeIcon className="text-violet-600">
      <circle {...TINT} cx="8" cy="15" r="4" />
      <path d="M10.9 12.1 20 3M17 6l2.5 2.5M14.5 8.5 17 11" />
    </StrokeIcon>
  );
}

// ログアウト: 囲いから外へ出る矢印。ログインと向きだけで対にする。
// 赤系だが red-700 は使わない — DANGER_BUTTON_CLASS (ゴミ箱へ / 永久削除) と
// 同格に見せると、戻せる操作を戻せない操作と取り違える
export function LogoutIcon() {
  return (
    <StrokeIcon className="text-rose-600">
      <path d="M15 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h10" />
    </StrokeIcon>
  );
}

// ログイン: 囲いの中へ入る矢印 (ログアウトの鏡像)。
// ログイン / ログアウトにティントは敷かない — 囲いが開いたパスなので、
// 塗ると閉じていない側が勝手に閉じて形が崩れる
export function LoginIcon() {
  return (
    <StrokeIcon className="text-emerald-600">
      <path d="M9 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
      <path d="M14 17l5-5-5-5" />
      <path d="M19 12H9" />
    </StrokeIcon>
  );
}

// クレジット: 情報の "i" 丸 (docs/46-クレジット表記計画.md)。
// 点 (i の上) は他のアイコン (QrIcon の "M20 14v0" など) と同じく、
// strokeLinecap="round" の 0 長パスで打つ。色は情報の中立色 (slate)
export function InfoIcon() {
  return (
    <StrokeIcon className="text-slate-500">
      <circle {...TINT} cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v0" />
    </StrokeIcon>
  );
}

// テキストサイズ: 大小 2 つの "A" (docs/61-テキストサイズ計画.md §3)。
// 拡大鏡や ± の記号にはしない — 隣に ＋ / − のボタンが並ぶので、行頭にも
// 記号を置くと同じ話を二度する。文字そのものの大小で「文字の大きさ」を指す。
//
// **<text> でフォントに描かせない。** 字幅は端末のフォント任せで、serif の
// 実体が違えば右の A が viewBox からはみ出して脚が切れる (svg は既定で
// overflow:hidden)。他のアイコンと同じく線で描けば寸法は自分で決まる
export function TextSizeIcon() {
  return (
    <StrokeIcon className="text-indigo-600">
      <path d="M2 20l3-8 3 8M3 17.5h4" />
      <path d="M11 20l5-13 5 13M12.7 16h6.6" />
    </StrokeIcon>
  );
}

// GitHub だけは線画にしない。Octocat は塗りで成立している商標で、
// 線でなぞると別物になる。公式 octicon (mark-github, MIT) の形をそのまま使う。
// 同じ理由で色も付けない — 商標を勝手に塗り替えないため、ここだけ行の文字色に従う
export function GithubIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={SIZE_CLASS}
      fill="currentColor"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

// 下部操作バー用アイコン (docs/31-下部操作バー計画.md §3-3)
// SIZE_CLASS は 20px だが、ここは 24px (タップ領域 44px に合わせて大きめ)
//
// メニュー側と違い、色クラスは持たせず currentColor のまま置く。
// 選択スロットは押下中にバーごと bg-blue-600 + text-white へ反転するので、
// 色は反転を知っている使用側 (BottomActionBar) から与える (§11-1)

const BOTTOM_BAR_ICON_CLASS = "size-6 shrink-0";

function StrokeIconLarge({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={BOTTOM_BAR_ICON_CLASS}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// スキャン: QR コードの枠 (メニューの QrIcon と同形、24px で拡大)
export function ScanIcon() {
  return (
    <StrokeIconLarge>
      <rect {...TINT} x="2" y="2" width="9" height="9" rx="1" />
      <rect {...TINT} x="13" y="2" width="9" height="9" rx="1" />
      <rect {...TINT} x="2" y="13" width="9" height="9" rx="1" />
      <path d="M13 13h4v4h-4zM22 13v0M13 22v0M22 22v4M22 19h1" />
    </StrokeIconLarge>
  );
}

// 画像検索: 写真フレーム + 虫眼鏡
export function ImageSearchIcon() {
  return (
    <StrokeIconLarge>
      <rect {...TINT} x="3" y="3" width="12" height="12" rx="1" />
      <circle cx="8" cy="8" r="2" />
      <path d="M18 18l3.5 3.5M18 14a4 4 0 0 1 4 4" />
    </StrokeIconLarge>
  );
}

// 表示切替: リスト (コンパクト表示用)
export function ListViewIcon() {
  return (
    <StrokeIconLarge>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <rect {...TINT} x="3" y="4" width="2" height="2" rx="0.5" />
      <rect {...TINT} x="3" y="10" width="2" height="2" rx="0.5" />
      <rect {...TINT} x="3" y="16" width="2" height="2" rx="0.5" />
    </StrokeIconLarge>
  );
}

// 表示切替: グリッド (カード表示用)
export function GridViewIcon() {
  return (
    <StrokeIconLarge>
      <rect {...TINT} x="3" y="3" width="7" height="7" rx="1" />
      <rect {...TINT} x="14" y="3" width="7" height="7" rx="1" />
      <rect {...TINT} x="3" y="14" width="7" height="7" rx="1" />
      <rect {...TINT} x="14" y="14" width="7" height="7" rx="1" />
    </StrokeIconLarge>
  );
}

// 表示切替: masonry (画像表示用)。高さ不揃いのタイルで「画像が敷き詰まる」
// 形にする。GridViewIcon (均等 2×2) との差は高さの不揃いだけに抑えて、
// 同じ「表示」スロットの仲間だと判るようにする。虫眼鏡付きの
// ImageSearchIcon は流用しない — 隣の「画像検索」スロットと同じ絵になり
// 狙えなくなる (docs/31 §11-1 の色と形で狙う原則)
export function ImageViewIcon() {
  return (
    <StrokeIconLarge>
      <rect {...TINT} x="3" y="3" width="8" height="11" rx="1" />
      <rect {...TINT} x="13" y="3" width="8" height="7" rx="1" />
      <rect {...TINT} x="3" y="16" width="8" height="5" rx="1" />
      <rect {...TINT} x="13" y="12" width="8" height="9" rx="1" />
    </StrokeIconLarge>
  );
}

// 並び順: 上下矢印。面になるシェイプが無いのでティントは敷かない
export function SortIcon() {
  return (
    <StrokeIconLarge>
      <path d="M12 5v14M5 12l7-7 7 7M5 12l7 7 7-7" />
    </StrokeIconLarge>
  );
}

// 選択: チェックボックス
export function SelectIcon() {
  return (
    <StrokeIconLarge>
      <rect {...TINT} x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 12l3 3 6-6" />
    </StrokeIconLarge>
  );
}

// 以下、ノート編集の下部バー用アイコン (docs/31 と同じ StrokeIconLarge 24px)。
// 色は使用側 (EditToolbar) から与える。隣に必ず同じ意味の文字ラベルがある。

// 更新 (保存): フロッピー。主ボタンなので他と混ざらない普遍的な保存の絵にする
export function SaveIcon() {
  return (
    <StrokeIconLarge>
      <path
        {...TINT}
        d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
      />
      <path d="M8 4v5h7V4M8 21v-6h8v6" />
    </StrokeIconLarge>
  );
}

// 元に戻す (undo): 左へ回り込む矢印
export function UndoIcon() {
  return (
    <StrokeIconLarge>
      <path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 6 6v1" />
    </StrokeIconLarge>
  );
}

// やり直す (redo): undo の左右反転
export function RedoIcon() {
  return (
    <StrokeIconLarge>
      <path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0-6 6v1" />
    </StrokeIconLarge>
  );
}

// 画像を挿入: 写真フレーム + 「+」。画像検索 (フレーム+虫眼鏡) と絵で見分ける
export function ImageInsertIcon() {
  return (
    <StrokeIconLarge>
      <rect {...TINT} x="3" y="4" width="13" height="13" rx="1" />
      <circle cx="7.5" cy="8.5" r="1.5" />
      <path d="M3 14l3.5-3.5L11 15" />
      <path d="M18 15v6M15 18h6" />
    </StrokeIconLarge>
  );
}

// 録音: マイク
export function MicIcon() {
  return (
    <StrokeIconLarge>
      <rect {...TINT} x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </StrokeIconLarge>
  );
}

// 録画: ビデオカメラ (本体 + 三角の突き出し)
export function VideoIcon() {
  return (
    <StrokeIconLarge>
      <rect {...TINT} x="3" y="6" width="12" height="12" rx="2" />
      <path d="M15 10l6-3v10l-6-3z" />
    </StrokeIconLarge>
  );
}

// お絵かき: 鉛筆
export function DrawIcon() {
  return (
    <StrokeIconLarge>
      <path {...TINT} d="M4 20l1-4L16 5l3 3L8 19l-4 1z" />
      <path d="M14 7l3 3" />
    </StrokeIconLarge>
  );
}

// 画像を OCR: 画像フレーム + 文字を読み取る線。OCR は「画像から文字」なので
// フレームの中に文章の線を入れる
export function OcrIcon() {
  return (
    <StrokeIconLarge>
      <rect {...TINT} x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 12h10M7 15h6" />
    </StrokeIconLarge>
  );
}

// シークレット挿入: 南京錠。掛け金 (上の弧) と本体で「閉じている」を示す。
// 鍵 (KeyIcon) と紛らわしくならないよう、あちらは鍵そのもの、こちらは錠前
export function LockIcon() {
  return (
    <StrokeIconLarge>
      <rect {...TINT} x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </StrokeIconLarge>
  );
}
