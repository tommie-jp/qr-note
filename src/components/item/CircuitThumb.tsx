// 一覧に出す回路図サムネ (docs/68-一覧回路図サムネ計画.md §3)。
//
// 受け取るのは SVG の hash で、中身は /api/circuits/svg/<hash> が検査してから
// 配る (docs/124 §1)。一覧の応答に SVG を埋め込んでいた頃は、同じ図を検索の
// たびに運び直していた。
//
// **行のサムネは <img> で出し、DOM に展開しない** (docs/122 §10-2)。
// 1 枚に <text> が数十個あり、オペアンプの検索 (17 枚) では DOM 3,454 の
// うち約 2,000 がサムネの SVG で、SVG の文字の配置だけでレイアウトが 30ms
// 太っていた。<img> の中の SVG はページの CSS を受けないので、TeX の字体
// (/tikzjax/fonts.css) が外れて kΩ などの記号が別の字に化ける。行の大きさ
// (24〜96px) では文字の高さが 1〜3px で読めないので、見た目は変わらない。
// 文字が読める大きさのタイル (画像モード) は今までどおり埋め込む
//
// 取得側 (src/lib/circuit/thumbs.ts) は prisma を引き込むサーバ専用 module
// なので、ここから import しないこと (型だけなら可)。
//
// 大きさ合わせ: 行は object-contain (図全体を余白付きで見せ、切り抜かない)。
// タイルはサーバ生成の SVG の固定 px 属性 (width="222.046" など) を
// globals.css の .circuit-thumb > svg が枠いっぱいに上書きし、viewBox +
// preserveAspectRatio の既定 (xMidYMid meet) が同じ contain に働く。
"use client";

import { circuitSvgUrl } from "@/lib/circuit/svgUrl";
import { circuitSvgCache } from "@/lib/client/circuitSvgStore";

type CircuitThumbProps =
  | {
      // 小/大表示のサムネ枠 (ItemRow)。画像サムネ (RowThumb) と同じ寸法クラス
      // (size-10 / size-24) を受けて同じ場所に収まる
      variant: "row";
      // SVG の hash (docs/124 §1)。中身は /api/circuits/svg/<hash> が配る
      hash: string;
      sizeClass: string;
    }
  | {
      // 画像モードのタイル (ImageMasonry)。画像タイルの <img> と同じ
      // aspect-square の正方形
      variant: "tile";
      hash: string;
    };

// 装飾扱い (行は alt=""、タイルは aria-hidden)。隣のタイトルが中身を説明する
// (RowThumb と同じ理屈)。SVG 内の <text> (素子名など) を読み上げに混ぜない意図もある
export function CircuitThumb(props: CircuitThumbProps) {
  if (props.variant === "row") {
    return (
      // next/image は使わない (SVG で、縮小も要らない)。口が immutable なので
      // 2 回目からはブラウザのキャッシュから出る
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={circuitSvgUrl(props.hash)}
        alt=""
        loading="lazy"
        decoding="async"
        className={`circuit-thumb ${props.sizeClass} shrink-0 self-center rounded bg-gray-100 object-contain`}
      />
    );
  }
  return <CircuitTile hash={props.hash} />;
}

// タイルは埋め込む (文字をページの字体で描くため)。届くまでは同じ大きさの
// 灰色の枠だけを出し、届いたら中身を入れる (枠の大きさは変わらないので跳ねない)
function CircuitTile({ hash }: { hash: string }) {
  const svg = circuitSvgCache.useEntry(hash)?.value;
  return svg === undefined ? (
    <span aria-hidden className="circuit-thumb block aspect-square w-full bg-gray-100" />
  ) : (
    <span
      aria-hidden
      className="circuit-thumb block aspect-square w-full bg-gray-100"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
