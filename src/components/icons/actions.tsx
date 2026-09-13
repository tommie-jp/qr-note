// 特定の帯やメニューに属さない操作のアイコン (ゴミ箱 docs/66・コピーと済んだ印 docs/21)。
// 色をアイコン側で持つかどうかは 1 つずつ違うので、各アイコンの注に書いた

import { StrokeIcon, TINT } from "./primitives";

// ゴミ箱 (docs/66-行アクション計画.md §6)。
//
// **色は持たせず currentColor のまま置く。** メニュー用アイコン (menu.tsx) と違い、
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
