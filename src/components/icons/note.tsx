// ノート画面の見出し行のアイコン (docs/82-ノート操作アイコン計画.md §2)。
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

import { StrokeIcon, TINT } from "./primitives";

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
// 地色ごと緑になるので、色は使う側が持つ (このファイルの頭のコメント)
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

// 以下、ノート本文に埋め込む発音ボタン (answer/TtsButton、docs/81-単語TTS発音計画.md)
// のアイコン。見出し行の一群とは別で、寸法 (16px) は本文の行に合わせ、色は
// 使う側 (ボタンの文字色) に従う。

// スピーカーのアイコン。アイコンライブラリは足さない (primitives.tsx の頭と
// 同じ判断)。本文には既に `[🔊](辞書)` の絵文字リンクが並ぶので、
// 絵文字ではなく線画にして「別の物」に見せる。
//
// 鳴っている間は波を点滅させる。止める操作ができることの合図で、
// 文字を足さずに状態を出せる
export function SpeakerIcon({ speaking }: { speaking: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="inline-block size-4 align-text-bottom"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M11 5 6.5 9H3v6h3.5L11 19z"
        fill="currentColor"
        fillOpacity={0.15}
      />
      <g className={speaking ? "animate-pulse" : undefined}>
        <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />
        <path d="M17.5 7a7 7 0 0 1 0 10" />
      </g>
    </svg>
  );
}
