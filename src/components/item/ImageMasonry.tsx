import { noteName } from "@/lib/items/noteName";
import Link from "next/link";
import type { Item } from "@/generated/prisma/client";
// 型は葉 (circuit/types.ts / markdown/mathTextTypes.ts) から取る — 取得側の
// circuit/thumbs.ts / markdown/mathText.ts はサーバ専用 module で、値の import は不可
// (offline/circuits.ts と同じ線引き)
import type { CircuitThumbMap } from "@/lib/circuit/types";
import type { MathTextMap } from "@/lib/markdown/mathTextTypes";
import { allViewerMedia, thumbUrl } from "@/lib/images/memoImages";
import { memoSummary } from "@/lib/markdown/memoSummary";
import { tagSearchHref } from "@/lib/markdown/tags/tags";
import { CircuitThumb } from "./CircuitThumb";
import { VideoTilePoster } from "./VideoTilePoster";
import { ViewerImageButton } from "../imageviewer/ViewerImageButton";
import { TileActions } from "./row-actions/TileActions";
import { MathText } from "../markdown/MathText";

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
  itemHref: (itemId: string) => string;
  // itemId → 描画済み回路図の SVG (docs/68-一覧回路図サムネ計画.md §4)。
  // ページ側 (サーバ) が circuit_svgs から引いて降ろす。未描画の図は
  // 入っていないので、無いものは無いなりに画像タイルだけが並ぶ
  circuitThumbs?: CircuitThumbMap;
  // itemId → 数式入りタイトルの KaTeX 済み HTML (docs/69-一覧数式計画.md)。
  // キャプションの 1 行目に使う。無いノートはプレーンテキストのまま
  mathTexts?: MathTextMap;
  // プレビューペイン (docs/86 §4) で右下に開いているノート。ItemList が
  // pathname から導いて降ろす (ItemRow の selected と同じ印を画像タイルにも
  // 付ける — 同じノートのタイルが複数あれば全部に付く)
  previewItemId?: string | null;
  // タイルに ⋮ メニューを付けるか (docs/107-行メニュー計画.md §7・§9)。
  // 立てる側がメニューの中身と送信の状態を持つ包みで囲む — 検索一覧は
  // SearchTileMenuProvider、ゴミ箱の一覧は TrashTileMenuProvider (row-actions/TileActions)
  tileActions?: boolean;
}

// タイルの中身。画像・動画 (サムネ / poster の URL を引く) か回路図 (SVG を
// 直接埋め込む) のどちらか。キャプションとリンクの組み方は共通。
// 動画も並べるのはスライドショーで流すため (docs/117 §8)。押せばビューアで再生する
type TileMedia =
  | { image: string; isVideo: boolean; hash?: never }
  // 回路図の SVG の hash (docs/124 §1)
  | { image?: never; isVideo?: never; hash: string };

export function ImageMasonry({
  items,
  itemHref,
  circuitThumbs,
  mathTexts,
  previewItemId,
  tileActions = false,
}: ImageMasonryProps) {
  // URL モードのノートは memo が空なので allViewerMedia("") === [] となり
  // 自然に落ちる (ItemRow のような isUrl 分岐は要らない)。
  // 回路図はノートごとに画像の後へ並べる (種類内は出現順)。本文の完全な
  // 出現順に混ぜるには画像 (正規表現) と回路図 (remark) の位置突き合わせが
  // 要る割に益が薄いので、この割り切りにしている (docs/68 §4)
  // ノートごとのタイル数 (⋮ の確認文用)。本文の走査はノート 1 件につき 1 回
  // にしたいので、タイルを組むついでに数える (tileCountOf を毎タイル呼ばない)
  const tileCounts = new Map<string, number>();
  const tiles = items.flatMap((item) => {
    const itemTiles = [
      ...allViewerMedia(item.memo).map(
        ({ name, isVideo }): { item: Item; key: string; media: TileMedia } => ({
          item,
          // name はノート内では重複除去済みだが、別ノートが同じ画像を参照
          // できるので itemId と組で一意にする
          key: `${item.itemId}:${name}`,
          media: { image: name, isVideo },
        }),
      ),
      ...(circuitThumbs?.[item.itemId] ?? []).map(
        (hash, i): { item: Item; key: string; media: TileMedia } => ({
          item,
          key: `${item.itemId}:circuit:${i}`,
          media: { hash },
        }),
      ),
    ];
    tileCounts.set(item.itemId, itemTiles.length);
    return itemTiles;
  });

  if (tiles.length === 0) {
    // 検索には当たったが、このページの 20 件に画像持ちも描画済みの回路図持ちも
    // 無い。ページ割りはノート単位のまま (docs/32 §4) なので起こり得る
    return (
      <p className="rounded border border-gray-200 bg-white px-4 py-6 text-center text-gray-500">
        このページには画像・動画・回路図がありません
      </p>
    );
  }

  return (
    // 行優先で埋まる Grid (1,2 / 3,4 / 5,6)。列数は指定せず、列幅 10rem を
    // 基準に画面が決める — card グリッド (docs/23 §1) と同じ auto-fill 思想。
    // 10rem はサムネ (長辺 320px, images/thumbnail.ts) が 2x DPR でほぼ等倍になる幅。
    // min(10rem,100%) は必須 — 器が 10rem より狭い端末で列が広がり横スクロール
    // が出るのを防ぐ (card で踏んだのと同じ罠)
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(10rem,100%),1fr))] gap-2">
      {tiles.map(({ item, key, media }) => {
        // URL モードのノートは memo が空でタイルにならないので isUrl 分岐は不要。
        // 画像しか無いノートはタイトルが空になり得るが、その場合は #番号 だけ出す
        const mathTitle = mathTexts?.[item.itemId]?.title;
        const title = mathTitle ? (
          <MathText html={mathTitle} />
        ) : (
          memoSummary(item.memo)
        );
        // プレビューで開いているノートのタイルは枠と地色で示す (ItemRow の
        // selected と同じ判断: hover 系の色より優先する)
        const selected = item.itemId === previewItemId;
        return (
          // relative … stretched link の基準。
          // @container … ⋮ を画像の下に揃える基準 (100cqw = 正方形の画像の高さ)
          // group … PC ではタイルにホバーしたときだけ ⋮ を出す (ROW_MENU_TRIGGER_CLASS)
          <li
            key={key}
            className={`group @container relative overflow-hidden rounded border ${
              selected
                ? "border-[var(--row-tint-border)] bg-[var(--row-tint-bg)]"
                : "border-gray-200 bg-white"
            }`}
          >
            {/* 画像はノートへのリンクの外に置く (docs/116 §1)。押すとビューアで
                大きく見せる釦になり (ViewerImageButton。z-10 で下の膜の上に出る)、
                1 行目 (#番号 タイトル) がノート詳細へのリンク。リンクの ::after を
                枠いっぱいに広げてタイルの残りを当たり判定にする (stretched link)。
                タグは別の行き先なので入れ子にできず、下で z-10 で膜の上に出す
                (ItemRow と同じ仕掛け・docs/32 §2)。ビューアの provider の外では
                画像は膜の下に居て、押せば今までどおりノートが開く */}
            {media.image !== undefined ? (
              /* next/image は使えない (ItemRow と同じ 401 問題)。
                 寸法は DB に無く読み込みで高さが決まるため、自然高のままだと
                 行の高さが読み込み順にガタつく。枠は aspect-square で正方形に
                 固定してレイアウトシフトを消しつつ、object-contain で画像**全体**
                 を余白付きで見せる (切り抜かない)。余った所は地色が埋め、これが
                 レターボックスと読み込み前の場所の気配を兼ねる (docs/32 §2)。
                 alt="" … すぐ下のキャプションが中身を説明する (ItemRow と同じ) */
              <ViewerImageButton
                target={{
                  itemId: item.itemId,
                  name: media.image,
                  href: itemHref(item.itemId),
                }}
                className="w-full"
              >
                {media.isVideo ? (
                  <VideoTilePoster name={media.image} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbUrl(media.image)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="block aspect-square w-full bg-gray-100 object-contain"
                  />
                )}
              </ViewerImageButton>
            ) : (
              /* 回路図は SVG をそのまま埋め込む (docs/68 §4)。枠の作法は
                 画像タイルと同じ正方形 + contain (CircuitThumb 側が持つ) */
              <CircuitThumb variant="tile" hash={media.hash} />
            )}
            <Link
              href={itemHref(item.itemId)}
              // 先読みしない (docs/118 §5)。行 (ItemRowCompact・ItemRowCard) と同じ。
              // 画像表示でも検索 1 回で 16〜20 本の /item の先読みが出ていた
              prefetch={false}
              // 押した瞬間に読み込み中の器へ題を出す印 (docs/86 §4-18。noteHint.ts)
              data-note-title={item.title.trim() || undefined}
              transitionTypes={["nav-forward"]}
              aria-current={selected ? "page" : undefined}
              className="block after:absolute after:inset-0"
            >
              {/* ⋮ (幅 36px・高さ 24px) はこの行の右端に重なる。
                  pr-9 … 題をその手前で切る。
                  min-h-7 … 行を ⋮ より高く取り、タグの無いタイルでも ⋮ を
                  li の中に収める (はみ出すと押した瞬間に li の中がスクロールし、
                  メニューが閉じる。RowActions.tsx の TRIGGER_PLACEMENT_CLASS) */}
              <div
                className={`flex items-baseline gap-1 pt-1 pl-1.5 ${
                  tileActions ? "min-h-7 pr-9" : "pr-1.5"
                }`}
              >
                <span className="truncate text-xs text-gray-600">{title}</span>
              </div>
            </Link>
            {item.tags.length > 0 && (
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 px-1.5 pt-0.5 pb-1">
                {item.tags.map((tag) => (
                  // relative z-10 … stretched link の膜より前に出す。下に居ると
                  // タグを押してもノートが開いてしまう
                  <Link
                    key={tag}
                    href={tagSearchHref(tag)}
                    // 先読みしない (docs/118 §5)
                    prefetch={false}
                    className="relative z-10 text-xs text-blue-700 hover:underline"
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            )}
            {tileActions && (
              <TileActions
                itemId={item.itemId}
                name={noteName(item)}
                tileCount={tileCounts.get(item.itemId) ?? 0}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ノート 1 件が並べるタイルの数 (画像・動画 + 描画済みの回路図)。⋮ からゴミ箱へ
// 入れるときの確認文で「このノートの 3 枚がまとめて消える」と言うのに使う。
// 数え方は上の tiles の組み方と同じ 2 つを足すだけ。0 ならタイルにならない
// (ゴミ箱の一覧が「画像表示では見えないノート」を数えるのにも使う)
export function tileCountOf(item: Item, circuitThumbs?: CircuitThumbMap): number {
  return (
    allViewerMedia(item.memo).length + (circuitThumbs?.[item.itemId]?.length ?? 0)
  );
}
