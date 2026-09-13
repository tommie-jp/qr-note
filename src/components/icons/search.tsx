// 検索窓の行に並ぶアイコン (docs/31-下部操作バー計画.md §2 の 2 ボタン)。
// スロットではないので 20px (SIZE_CLASS) 側に揃える — 36px の詰めたボタンに
// 24px を入れると枠いっぱいで窮屈になる。
//
// 色は使用側から与えない。この 3 つは押下で反転しない (下部バーの選択
// スロットと違う) ので、メニューのアイコンと同じくここで持つほうが散らばらない

import { StrokeIcon, TINT } from "./primitives";

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
