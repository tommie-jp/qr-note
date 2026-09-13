// ハンバーガーメニューの行頭アイコン (docs/11-アプリ的UIUX計画.md §6)。
//
// 色は「アイコン側」で持つ (docs/31-下部操作バー計画.md §11-4)。メニューには
// 押下状態による色の反転が無く、使う側が 6 コンポーネントに散っているため、
// 使用側で包むと同じ色指定が散らばる。行ラベルは HEADER_MENU_ITEM_CLASS の
// gray-700 のままで、svg の色指定だけが勝つ。
// 下部バーのアイコン (bottomBar.tsx) はこれと逆で、色を使用側から与える —
// 選択モードで白へ反転する条件分岐が BottomActionBar にあるため (§11-1)。

import { SIZE_CLASS, StrokeIcon, TINT } from "./primitives";

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

// 虫のアイコン (デバッグコンソールの出し入れ。docs/30-ブラウザログ計画.md §2)。
// もとは DebugConsoleButton.tsx の中の inline svg。行頭アイコンの作法
// (currentColor の線画・aria-hidden・機能色をアイコン側に持つ・面シェイプへ
// 薄いティント) はこのファイルの他のアイコンと揃えてある
// (docs/31-下部操作バー計画.md §11-4)。
// 黄は「警告」の色で、虫のモチーフと意味が合う。
// TINT を rect の属性の後ろに置くのは、移す前と描画結果 (属性の並び) を
// 1 文字も変えないため (icons.test.tsx)
export function BugIcon() {
  return (
    <StrokeIcon className="text-amber-600">
      <path d="M9 6a3 3 0 0 1 6 0" />
      <rect x="7" y="8" width="10" height="12" rx="5" {...TINT} />
      <path d="M3 12h4M17 12h4M4 7l3 2M20 7l-3 2M4 18l3-2M20 18l-3-2" />
    </StrokeIcon>
  );
}
