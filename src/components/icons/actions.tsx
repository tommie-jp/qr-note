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

// 復元 (ゴミ箱から戻す。docs/107 §9)。ぐるりと左へ回って元の所へ戻る矢印。
// 編集の UndoIcon (editor.tsx) とは別にする — あちらは 24px の下部バー用で、
// 「直前の編集を取り消す」の意味。こちらは 20px のメニュー項目で、隣に
// 並ぶ TrashIcon と大きさを揃える。色は currentColor のまま (使う側の文字色)
export function RestoreIcon() {
  return (
    <StrokeIcon>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4h4" />
    </StrokeIcon>
  );
}

// その他の操作 (輪で囲んだ横の三点。docs/107-行メニュー計画.md §2)。
//
// もとは縦の三点 ⋮ (Android・Google 系の作法) だったが、輪も地も無い点 3 つは
// 「押せる物」に見えなかった。ホバーで濃くなる手がかりも、ホバーの無い
// iPhone では出ない。そこで iOS のファイル・メモ・写真が使う ellipsis.circle の
// 形にした — iPhone の利用者にいちばん馴染みがあり、輪がボタンの縁を兼ねる。
// 横の ⋯ だけだと行末の省略記号 (…) と見分けにくいが、輪で囲めば紛れない。
// 点は塗りの丸で描く — 線画の円では 20px のとき中が抜けて輪にしか見えない。
// 色は currentColor のまま (ROW_MENU_TRIGGER_CLASS がホバーで濃くする。PC ではホバー中だけ出す)
export function MoreIcon() {
  return (
    <StrokeIcon>
      <circle cx="12" cy="12" r="9" />
      <circle cx="7.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

// 全画面で開く (下部ペインの札。docs/108 §3-6)。対角の 2 隅へ向く矢印で
// 「この枠を画面いっぱいに広げる」を描く。色は使う側 (ACTION_LINK_SKIN の
// text-blue-600) が持つ — 隣の ⋯ と同じ札に並ぶので、ここで色を決めない
export function OpenFullIcon() {
  return (
    <StrokeIcon>
      <path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6" />
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
