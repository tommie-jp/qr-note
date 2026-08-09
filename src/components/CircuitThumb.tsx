// 一覧に出す回路図サムネ (docs/68-一覧回路図サムネ計画.md §3)。
//
// SVG はサーバで描画・検査済み (assertSafeCircuitSvg) の文字列を受け取り、
// そのまま埋め込むだけ。CircuitDiagram と同じくクライアント JS も
// ローディング状態も無い。
//
// 取得側 (src/lib/circuitThumbs.ts) は prisma を引き込むサーバ専用 module
// なので、ここから import しないこと (型だけなら可)。
//
// 大きさ合わせは CSS に任せる: サーバ生成の SVG は width="222.046" のような
// 固定 px 属性を持つが、globals.css の .circuit-thumb > svg が枠いっぱいに
// 上書きし、viewBox + preserveAspectRatio の既定 (xMidYMid meet) が
// object-contain 相当に働く (図全体を余白付きで見せ、切り抜かない)。
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

// aria-hidden … 装飾扱い。隣のタイトルが中身を説明する (RowThumb の alt="" と
// 同じ理屈)。SVG 内の <text> (素子名など) を読み上げに混ぜない意図もある
export function CircuitThumb(props: CircuitThumbProps) {
  if (props.variant === "row") {
    return (
      <span
        aria-hidden
        className={`circuit-thumb ${props.sizeClass} shrink-0 self-center overflow-hidden rounded bg-gray-100`}
        dangerouslySetInnerHTML={{ __html: props.svg }}
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
