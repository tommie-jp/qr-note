import Link from "next/link";
import type { Item } from "@/generated/prisma/client";
// 値の import は不可 — circuitThumbs.ts は prisma を引き込むサーバ専用 module
// (offline/circuits.ts と同じ線引き)。型は erase されるので安全
import type { CircuitThumbMap } from "@/lib/circuitThumbs";
import { allImageNames, thumbUrl } from "@/lib/memoImages";
import { memoSummary } from "@/lib/memoSummary";
import { tagSearchHref } from "@/lib/tags";
import { CircuitThumb } from "./CircuitThumb";

// 画像表示モード (docs/32-画像表示モード計画.md)。ページ内のノート本文に
// 貼られた自前画像だけをグリッドで敷き詰め、写真からノートを探す入口にする。
//
// 当初は CSS multi-column の masonry だったが、multi-column は左の列を上から
// 下へ埋める (1,2,3 が縦並び)。オンデマンド表示 (docs/33) で末尾に足すたび
// 全タイルが列間で再配置され、「番号順に横へ並ぶ」感覚とも合わなくなったので
// 行優先で埋まる CSS Grid に変えた (docs/32 §1 追記)。名前は経緯を残すため据置。
//
// タイルは「画像 1 枚 = 1 リンク」でノート単位ではない。1 ノートに複数枚
// あれば全部並び (キャプションも各タイルに繰り返す)、画像の無いノートは
// タイルにならない。画像の下に compact 相当の 2 行 (#番号 タイトル / タグ) を
// 添えるため、タグリンクとの入れ子を避ける stretched link を ItemRow から
// 借りている (docs/32 §2)。
interface ImageMasonryProps {
  items: Item[];
  // ノートを開くリンク先を作る。ItemRow と同じく ItemList から降ってくる —
  // 検索状態をリンクに載せる約束 (docs/60-学習進捗計画.md §4) の置き場所を
  // 一覧側 1 か所に保つため。**任意にしない**: 省いても型が通ると、
  // 新しい一覧を足したときに前後ナビだけが黙って消える
  itemHref: (itemNo: string) => string;
  // itemNo → 描画済み回路図の SVG (docs/68-一覧回路図サムネ計画.md §4)。
  // ページ側 (サーバ) が circuit_svgs から引いて降ろす。未描画の図は
  // 入っていないので、無いものは無いなりに画像タイルだけが並ぶ
  circuitThumbs?: CircuitThumbMap;
}

// タイルの中身。画像 (サムネ URL を引く) か回路図 (SVG を直接埋め込む) の
// どちらか。キャプションとリンクの組み方は共通
type TileMedia = { image: string; svg?: never } | { image?: never; svg: string };

export function ImageMasonry({ items, itemHref, circuitThumbs }: ImageMasonryProps) {
  // URL モードのノートは memo が空なので allImageNames("") === [] となり
  // 自然に落ちる (ItemRow のような isUrl 分岐は要らない)。
  // 回路図はノートごとに画像の後へ並べる (種類内は出現順)。本文の完全な
  // 出現順に混ぜるには画像 (正規表現) と回路図 (remark) の位置突き合わせが
  // 要る割に益が薄いので、この割り切りにしている (docs/68 §4)
  const tiles = items.flatMap((item) => [
    ...allImageNames(item.memo).map(
      (name): { item: Item; key: string; media: TileMedia } => ({
        item,
        // name はノート内では重複除去済みだが、別ノートが同じ画像を参照
        // できるので itemNo と組で一意にする
        key: `${item.itemNo}:${name}`,
        media: { image: name },
      }),
    ),
    ...(circuitThumbs?.[item.itemNo] ?? []).map(
      (svg, i): { item: Item; key: string; media: TileMedia } => ({
        item,
        key: `${item.itemNo}:circuit:${i}`,
        media: { svg },
      }),
    ),
  ]);

  if (tiles.length === 0) {
    // 検索には当たったが、このページの 20 件に画像持ちも描画済みの回路図持ちも
    // 無い。ページ割りはノート単位のまま (docs/32 §4) なので起こり得る
    return (
      <p className="rounded border border-gray-200 bg-white px-4 py-6 text-center text-gray-500">
        このページには画像・回路図がありません
      </p>
    );
  }

  return (
    // 行優先で埋まる Grid (1,2 / 3,4 / 5,6)。列数は指定せず、列幅 10rem を
    // 基準に画面が決める — card グリッド (docs/23 §1) と同じ auto-fill 思想。
    // 10rem はサムネ (長辺 320px, thumbnail.ts) が 2x DPR でほぼ等倍になる幅。
    // min(10rem,100%) は必須 — 器が 10rem より狭い端末で列が広がり横スクロール
    // が出るのを防ぐ (card で踏んだのと同じ罠)
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(10rem,100%),1fr))] gap-2">
      {tiles.map(({ item, key, media }) => {
        // URL モードのノートは memo が空でタイルにならないので isUrl 分岐は不要。
        // 画像しか無いノートはタイトルが空になり得るが、その場合は #番号 だけ出す
        const title = memoSummary(item.memo);
        return (
          // relative … stretched link の基準
          <li
            key={key}
            className="relative overflow-hidden rounded border border-gray-200 bg-white"
          >
            {/* 画像 + 1 行目 (#番号 タイトル) をノート詳細への 1 本のリンクにし、
                ::after を枠いっぱいに広げてタイル全体を当たり判定にする
                (stretched link)。タグは別の行き先なので入れ子にできず、下で
                z-10 で膜の上に出す (ItemRow と同じ仕掛け・docs/32 §2) */}
            <Link
              href={itemHref(item.itemNo)}
              transitionTypes={["nav-forward"]}
              className="block after:absolute after:inset-0"
            >
              {media.image !== undefined ? (
                /* next/image は使えない (ItemRow と同じ 401 問題)。
                   寸法は DB に無く読み込みで高さが決まるため、自然高のままだと
                   行の高さが読み込み順にガタつく。枠は aspect-square で正方形に
                   固定してレイアウトシフトを消しつつ、object-contain で画像**全体**
                   を余白付きで見せる (切り抜かない)。余った所は地色が埋め、これが
                   レターボックスと読み込み前の場所の気配を兼ねる (docs/32 §2)。
                   alt="" … すぐ下のキャプションが中身を説明する (ItemRow と同じ) */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={thumbUrl(media.image)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full bg-gray-100 object-contain"
                />
              ) : (
                /* 回路図は SVG をそのまま埋め込む (docs/68 §4)。枠の作法は
                   画像タイルと同じ正方形 + contain (CircuitThumb 側が持つ) */
                <CircuitThumb variant="tile" svg={media.svg} />
              )}
              <div className="flex items-baseline gap-1 px-1.5 pt-1">
                <span className="shrink-0 font-mono text-xs font-bold">
                  #{item.itemNo}
                </span>
                <span className="truncate text-xs text-gray-600">{title}</span>
              </div>
            </Link>
            {item.tags.length > 0 && (
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 px-1.5 pb-1 pt-0.5">
                {item.tags.map((tag) => (
                  // relative z-10 … stretched link の膜より前に出す。下に居ると
                  // タグを押してもノートが開いてしまう
                  <Link
                    key={tag}
                    href={tagSearchHref(tag)}
                    className="relative z-10 text-xs text-blue-700 hover:underline"
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
