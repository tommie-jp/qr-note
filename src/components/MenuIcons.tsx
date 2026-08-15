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
// sizeClass … 既定 (20px) を**差し替える**ための口。className に size-4 を
// 足す形では効かない — Tailwind の同種ユーティリティは class 属性の並び順では
// なく生成 CSS の並び順で勝敗が決まるので、size-5 が残って効かないことがある。
// 使う側が「どちらが勝つか」を読めないのは危ないので、差し替えは別の口にする
function StrokeIcon({
  children,
  className,
  sizeClass = SIZE_CLASS,
}: {
  children: React.ReactNode;
  className?: string;
  sizeClass?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className ? `${sizeClass} ${className}` : sizeClass}
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

// 選択色: パレット (docs/88-選択行の色計画.md §3)。絵の具の穴を 3 つ開けた
// 定番の形。色見本を並べた四角にはしない — 隣に本物の色見本が 6 つ並ぶので、
// 行頭でも同じ話をすることになる (テキストサイズの ＋ / − と同じ判断)。
//
// **アイコン自体は 1 色のまま** (他の行と揃える)。ここを虹色に塗ると、
// この行だけ絵が主張して「選ばれている色」の見分けを邪魔する
export function PaletteIcon() {
  return (
    <StrokeIcon className="text-pink-600">
      {/* パレットの輪郭。右下の切れ込み (親指を入れる所) を作らず、
          閉じた曲線の代わりに「一周して中へ戻る」形にすると線が増えるので、
          円 + 穴の素直な形で通す */}
      <path
        {...TINT}
        d="M12 3a9 9 0 1 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1a1.5 1.5 0 0 1 1.09-2.5H17a4 4 0 0 0 4-4c0-4.42-4.03-9-9-9Z"
      />
      <path d="M7.5 12v0M9.5 8.5v0M14 7.5v0M17 10.5v0" />
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

// sizeClass … 既定 (24px) を**差し替える**ための口 (StrokeIcon と同じ理由)。
// className に size-5 を足す形では効かない — 同種のユーティリティは class 属性の
// 並び順ではなく生成 CSS の並び順で勝敗が決まるので、size-6 が残ることがある。
// 検索窓の行に置くスキャン・画像検索 (SearchTools) が 20px を要求する —
// 隣の虫眼鏡・＋ (StrokeIcon = 20px) と大きさを揃えるため
function StrokeIconLarge({
  children,
  sizeClass = BOTTOM_BAR_ICON_CLASS,
}: {
  children: React.ReactNode;
  sizeClass?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={sizeClass}
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

// スキャン: QR コードの枠 (メニューの QrIcon と同形、24px で拡大)。
// sizeClass … 検索窓の行 (SearchTools) だけ 20px に縮める
export function ScanIcon({ sizeClass }: { sizeClass?: string }) {
  return (
    <StrokeIconLarge sizeClass={sizeClass}>
      <rect {...TINT} x="2" y="2" width="9" height="9" rx="1" />
      <rect {...TINT} x="13" y="2" width="9" height="9" rx="1" />
      <rect {...TINT} x="2" y="13" width="9" height="9" rx="1" />
      <path d="M13 13h4v4h-4zM22 13v0M13 22v0M22 22v4M22 19h1" />
    </StrokeIconLarge>
  );
}

// 画像検索: 写真フレーム + 虫眼鏡
export function ImageSearchIcon({ sizeClass }: { sizeClass?: string }) {
  return (
    <StrokeIconLarge sizeClass={sizeClass}>
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

// 表示切替: 見出し + 副題の 2 行 (中表示用)。ListViewIcon (1 行) との差を
// 「行の下に細い 2 行目が付く」だけに抑えて、同じ表示スロットの仲間だと
// 判るようにする (ImageViewIcon が GridViewIcon と揃えているのと同じ判断)
export function ListDetailViewIcon() {
  return (
    <StrokeIconLarge>
      <path d="M8 5h12M8 13h12" />
      <path d="M8 8.5h7M8 16.5h7" opacity="0.5" />
      <rect {...TINT} x="3" y="4" width="2" height="2" rx="0.5" />
      <rect {...TINT} x="3" y="12" width="2" height="2" rx="0.5" />
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

// 並び順: 上下矢印。面になるシェイプが無いのでティントは敷かない。
// 方向を持たない「並び替え」そのものの印で、長押しメニューの行頭に使う
export function SortIcon() {
  return (
    <StrokeIconLarge>
      <path d="M12 5v14M5 12l7-7 7 7M5 12l7 7 7-7" />
    </StrokeIconLarge>
  );
}

// 並び順の方向 (docs/64-並び順逆順計画.md §4)。下部バーのスロットは
// **アイコンで方向を出す** — ラベルに「↓」を足すと、いちばん長い
// 「アクセス順」が 5 スロットの幅 (320px 端末で 1 枠 56px) からあふれる。
// 矢印の頭を片側だけにして、上下両向きの SortIcon と一目で見分かるようにする
export function SortDescIcon() {
  return (
    <StrokeIconLarge>
      <path d="M12 4v16M6 14l6 6 6-6" />
    </StrokeIconLarge>
  );
}

export function SortAscIcon() {
  return (
    <StrokeIconLarge>
      <path d="M12 20V4M6 10l6-6 6 6" />
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

// 以下、検索窓の行に並ぶアイコン (docs/31-下部操作バー計画.md §2 の 2 ボタン)。
// スロットではないので 20px (SIZE_CLASS) 側に揃える — 36px の詰めたボタンに
// 24px を入れると枠いっぱいで窮屈になる。
//
// 色は使用側から与えない。この 3 つは押下で反転しない (下部バーの選択
// スロットと違う) ので、メニューのアイコンと同じくここで持つほうが散らばらない

// 検索: 虫眼鏡。「検索」の文字を置き換える (docs/62 §5)。柄はレンズの右下へ
// 45 度で下ろす — 世の中の虫眼鏡がほぼこの向きで、逆にすると別の道具に見える。
// 色を持たないのは青い主ボタンの上に白抜きで載るため (currentColor に従う)
export function SearchIcon() {
  return (
    <StrokeIcon>
      <circle {...TINT} cx="11" cy="11" r="6" />
      <path d="M15.5 15.5L21 21" />
    </StrokeIcon>
  );
}

// 新規ノート: ＋ (docs/62 §4)。
//
// **文字の "+" をやめて線で描くのが要点。** 文字はフォントごとに字面の中で
// 上下位置が違い、ボタンの中央に置いたつもりでも下寄り・左寄りに見えていた
// (行ボックスの中でベースラインに載るため)。svg なら viewBox の中心が
// そのまま図形の中心になる。
//
// 緑にするのは「足す」の合図。隣の検索ボタン (青い主ボタン) と役割が違うので、
// 同じ青で並べると 2 つの正方形が同じ物に見える
export function PlusIcon() {
  return (
    <StrokeIcon className="text-emerald-600">
      <path d="M12 5v14M5 12h14" />
    </StrokeIcon>
  );
}

// 検索語を消す: ✕ (docs/62 §6)。
//
// type="search" の標準の消去ボタンは Windows の Chrome/Edge にはあるが
// iOS Safari と Android Chrome には無く、スマホだけ長い検索語を 1 文字ずつ
// 消す羽目になっていた。標準側は常に隠して、これに一本化する。
// 入力欄の中に重ねるので他より小さい (16px)。StrokeIcon に size-4 を渡す
// 形にはしない — Tailwind の勝敗はクラス属性の並びではなく CSS の定義順で
// 決まるため、size-5 と size-4 を並べても狙ったほうが勝つとは限らない
// (ui.ts の BOX_SKIN と同じ理由)。線も細くする (小さい図形では 1.8 は太い)
export function ClearIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
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

// 書式メニュー (docs/70-編集ライブプレビュー計画.md §6)。
// 大文字の「A」に下線 — 文字に何かを掛ける、の一般的な絵
export function FormatIcon() {
  return (
    <StrokeIconLarge>
      <path d="M5 15L10 5l5 10M6.5 12h7" />
      <path d="M4 20h16" />
    </StrokeIconLarge>
  );
}

// ライブプレビューの切り替え (docs/70-編集ライブプレビュー計画.md §4)。
// 「記法が装飾に変わる」ことを、大小 2 段の文字組み + 下線で表す。
// 目のアイコン (プレビュー) にしないのは、この画面では「閲覧に切り替える」
// (markdown タブ) と紛らわしいため — 切り替わるのは編集中の見え方だけ
export function LivePreviewIcon() {
  return (
    <StrokeIconLarge>
      <path d="M4 8h7M4 12h7M4 16h4" />
      <path d="M15 16V8h2.5a2.5 2.5 0 0 1 0 5H15" />
    </StrokeIconLarge>
  );
}

// ノート内検索 (docs/76-ノート内検索計画.md §2)。虫眼鏡は検索画面の
// SearchIcon と同じ形で、下部バーの寸法 (24px) に拡大したもの — 同じ意味の
// 絵を 2 通り描かない。柄の向きも揃える (世の中の虫眼鏡がほぼこの向き)
export function FindIcon() {
  return (
    <StrokeIconLarge>
      <circle {...TINT} cx="11" cy="11" r="6" />
      <path d="M15.5 15.5L21 21" />
    </StrokeIconLarge>
  );
}

// 以下 3 つは検索バーの中の小さなボタン (20px)。色は持たせない —
// 押せない間 (0 件) は薄く、押せる間は文字色に従う
//
// 前の一致 / 次の一致。∧ ∨ は「上の一致へ / 下の一致へ」で、本文の並び順
// そのもの。← → にしないのは、横書きの本文で左右が「行の中の移動」に見えるため
export function ChevronUpIcon() {
  return (
    <StrokeIcon>
      <path d="M6 15l6-6 6 6" />
    </StrokeIcon>
  );
}

export function ChevronDownIcon() {
  return (
    <StrokeIcon>
      <path d="M6 9l6 6 6-6" />
    </StrokeIcon>
  );
}

// 置換行を開く。2 本の矢印が入れ替わる形で「置き換え」を表す
export function ReplaceIcon() {
  return (
    <StrokeIcon>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </StrokeIcon>
  );
}

// ゴミ箱 (docs/66-行アクション計画.md §6)。
//
// **色は持たせず currentColor のまま置く。** 上のメニュー用アイコンと違い、
// 置かれる場所ごとに色が違う — 一括ツールバーと行アクションでは赤 (危険な
// 操作)、0 件案内では青 (リンクの一部) になる。ここで色を決めると使う側が
// 毎回それを打ち消すことになる。
//
// これまで絵文字の 🗑 を使っていた場所も、すべてこれに置き換えた。絵文字は
// 端末ごとに字形も色も違い、単色の線画が並ぶ中に 1 つだけ混ざるとそこが
// 浮く (縦位置もフォント任せで揃わない)
// 大きさを受けるのはこの 1 つだけ。検索結果の件数行 (text-xs) に並べるときに、
// 既定の 20px では文字より背が高くなって行を押し広げるため
// (docs/31 §11-4 の「色はアイコン側」はそのまま — 受けるのは大きさだけ)
export function TrashIcon({ small = false }: { small?: boolean } = {}) {
  return (
    <StrokeIcon sizeClass={small ? "size-4 shrink-0" : undefined}>
      <path d="M4 7h16" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path
        {...TINT}
        d="M6 7h12l-.8 12.1a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9z"
      />
      <path d="M10.5 11.5v5.5M13.5 11.5v5.5" />
    </StrokeIcon>
  );
}

// コピー (docs/21-ログ表示計画.md §6)。重ねた 2 枚の紙で「同じ物が 2 つに
// なる」を描く。クリップボードの絵にはしない — バインダーの留め具は 20px では
// ただの突起に潰れ、SaveIcon (フロッピー) と見分けが付かなくなる。
//
// 色はここで持つ (置かれるのは /logs の 1 箇所だけで、押下で反転しない)。
// 隣に並ぶ TrashIcon が赤なので、青系にして絵より先に色で拾い分けられるようにする
export function CopyIcon() {
  return (
    <StrokeIcon className="text-sky-600">
      <rect {...TINT} x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H5.5A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15" />
    </StrokeIcon>
  );
}

// 済んだ印 (コピーできた合図)。CopyIcon と入れ替えて出すので、
// 同じ 20px の枠で形がはっきり違う裸のチェックにする (SelectIcon の
// 囲み付きチェックは「選ぶ」の意味を持つので流用しない)。
// 色は成否の合図そのものなのでここで持つ
export function CheckIcon() {
  return (
    <StrokeIcon className="text-emerald-600">
      <path d="M4.5 12.5l5 5 10-11" />
    </StrokeIcon>
  );
}

// 以下、ノート画面の見出し行のアイコン (docs/82-ノート操作アイコン計画.md §2)。
// 20px (SIZE_CLASS) 側に揃える — 隣に text-sm のラベルが並ぶ行で、下部バーの
// 24px を入れると行が伸びる。
//
// 色は**アイコン側**が持つ (メニューと同じ流儀)。押下で反転しないうえ、
// 4 つの操作リンクを「絵の形より先に色で拾い分ける」ためのものなので、
// 行の中で色が重ならないことがこの一群の要件になる:
//   編集 emerald / 履歴 orange / QR sky / ページ indigo / 記法 purple
//
// 状態を出すトグル (公開・オフライン) だけは逆で、色を持たない — ボタンの
// 地色ごと状態で変わるので、色は使う側 (STATE_TOGGLE_CLASS の colorClass) が
// 全部持つ (TrashIcon と同じ理由)

// 編集: 紙と鉛筆。DrawIcon (お絵かき) も鉛筆だが、あちらは鉛筆だけ・こちらは
// 紙に書いている形にして、同じ画面に並んでも別の操作だと判るようにする
export function EditIcon() {
  return (
    <StrokeIcon className="text-emerald-600">
      <path
        {...TINT}
        d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"
      />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L13 14l-4 1 1-4z" />
    </StrokeIcon>
  );
}

// 記法 (メモ記法の説明): 本。中の線は「読む文章がある」ことの印。
// LogIcon (書類) と紛れないよう、綴じ side の背を立てて本の形にする
export function NotationIcon() {
  return (
    <StrokeIcon className="text-purple-600">
      <path
        {...TINT}
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 0 4 20.5z"
      />
      <path d="M8 7.5h7M8 11h5" />
    </StrokeIcon>
  );
}

// ページ送り中: 1 枚の紙の左右に送りの山形。QR (三隅の四角) と形が近いので、
// 紙は縦長にして山形を外へ出す。CopyIcon の「重なった 2 枚」は使わない —
// あれは「同じ物が 2 つになる」の絵で、ページの並びではない
export function PagedIcon() {
  return (
    <StrokeIcon className="text-indigo-600">
      <rect {...TINT} x="8" y="4" width="8" height="16" rx="1" />
      <path d="M4.5 9.5 2.5 12l2 2.5M19.5 9.5l2 2.5-2 2.5" />
    </StrokeIcon>
  );
}

// 通し表示中: 上下の枠からはみ出す 1 本の帯。svg は既定で overflow:hidden
// なので、枠で切れた帯が「まだ続いている」を表す。巻物や矢印にしないのは、
// 20px では巻きの渦が潰れ、矢印は「下へ送る」操作に見えるため
export function ContinuousIcon() {
  return (
    <StrokeIcon className="text-indigo-600">
      <path {...TINT} d="M6 0h12v24H6z" />
      <path d="M9 5h6M9 9h6M9 13h6M9 17h4" />
    </StrokeIcon>
  );
}

// 前 / 次のページ (docs/82 §4)。文字を置き換えるので、山形だけの素直な形に
// する — 紙の絵を足すと 20px では潰れ、隣の PagedIcon とも紛れる。
// ページの並びと同じ左右で、上下の ChevronUpIcon (ノート内検索の一致送り) とは
// 向きで見分ける
export function PagePrevIcon() {
  return (
    <StrokeIcon className="text-indigo-600">
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </StrokeIcon>
  );
}

export function PageNextIcon() {
  return (
    <StrokeIcon className="text-indigo-600">
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </StrokeIcon>
  );
}

// 公開中: 地球儀 (誰でも見られる)。**色は持たない** — 公開のボタンは
// 地色ごと緑になるので、色は使う側が持つ (この節の頭のコメント)
export function PublicIcon() {
  return (
    <StrokeIcon>
      <circle {...TINT} cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </StrokeIcon>
  );
}

// 非公開: 南京錠。LockIcon (シークレット挿入) と同じモチーフだが、あちらは
// 下部バーの 24px。同じ意味の絵を 2 通り描かないための寸法違いの兄弟
export function PrivateIcon() {
  return (
    <StrokeIcon>
      <rect {...TINT} x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </StrokeIcon>
  );
}

// オフラインで使う印**なし**の状態: 雲 (中身はサーバに置いたまま)。
// OfflinePinIcon (端末へ落とす受け皿) と対にする。
//
// **斜線を入れた雲 (圏外の印) にはしない。** これはボタンのいまの状態を出す
// 絵で、「通信できない」という別の話に読める向きは避ける (OfflinePinIcon の
// コメントと同じ判断)。色は持たない — 印の有無でボタンの地色ごと変わる
export function OfflineOffIcon() {
  return (
    <StrokeIcon>
      <path
        {...TINT}
        d="M7.5 19h9.5a3.5 3.5 0 0 0 .4-7 5.5 5.5 0 0 0-10.5-1.2A4 4 0 0 0 7.5 19z"
      />
    </StrokeIcon>
  );
}

// オフラインで使う印 (docs/65-オフライン対応計画.md §7)。
// 「端末へ落とす」を下向きの矢印と受け皿で描く。
//
// **雲に斜線 (いわゆる圏外の印) にはしない。** あれは「通信できない」という
// 状態を表す絵で、ここは「持ち出す」という操作を押す物である。押した結果が
// 「圏外になる」と読めてしまう向きは避ける。
//
// TrashIcon と同じく色は持たせない — 一括ツールバー (青) と、後から別の場所へ
// 置くときとで色が変わるため。
export function OfflinePinIcon() {
  return (
    <StrokeIcon>
      <path d="M12 3v9" />
      <path d="M8.5 8.5 12 12l3.5-3.5" />
      <path
        {...TINT}
        d="M4 14h4l1.2 2.5h5.6L16 14h4v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"
      />
    </StrokeIcon>
  );
}
