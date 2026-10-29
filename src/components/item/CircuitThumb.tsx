// 一覧に出す回路図サムネ (docs/68-一覧回路図サムネ計画.md §3)。
//
// SVG はサーバで描画・検査済み (assertSafeCircuitSvg) の文字列を受け取る。
// CircuitDiagram と同じくクライアント JS もローディング状態も無い。
//
// **行のサムネは <img> (data URL) で出し、DOM に展開しない** (docs/122 §10-2)。
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
import { svgDataUri } from "@/lib/circuit/svgDataUri";

type CircuitThumbProps =
  | {
      // 小/大表示のサムネ枠 (ItemRow)。画像サムネ (RowThumb) と同じ寸法クラス
      // (size-10 / size-24) を受けて同じ場所に収まる
      variant: "row";
      svg: string;
      sizeClass: string;
    }
  | {
      // 画像モードのタイル (ImageMasonry)。画像タイルの <img> と同じ
      // aspect-square の正方形
      variant: "tile";
      svg: string;
    };

// 装飾扱い (行は alt=""、タイルは aria-hidden)。隣のタイトルが中身を説明する
// (RowThumb と同じ理屈)。SVG 内の <text> (素子名など) を読み上げに混ぜない意図もある
export function CircuitThumb(props: CircuitThumbProps) {
  if (props.variant === "row") {
    return (
      // next/image は使わない (data URL で、縮小も要らない)
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={svgDataUri(props.svg)}
        alt=""
        decoding="async"
        className={`circuit-thumb ${props.sizeClass} shrink-0 self-center rounded bg-gray-100 object-contain`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="circuit-thumb block aspect-square w-full bg-gray-100"
      dangerouslySetInnerHTML={{ __html: props.svg }}
    />
  );
}
