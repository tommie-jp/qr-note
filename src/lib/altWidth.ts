// 画像記法の alt に混ぜた表示幅の記法 (markdownPipeline.tsx から移設)。
//
// **クライアントからも読むためにここへ移した。** 移設前の置き場
// (markdownPipeline.tsx) は Server Component 用の入れ物で、react-markdown・
// rehype-katex・remark 一式を抱えている。編集画面 (client) の添付チップが
// そこから import すると、その一式が丸ごとブラウザへ降ってくる
// (classifyImgSrc を imgSrcKind.ts へ移したのと同じ事情。docs/70 §5)。
//
// 剥がす規則を 1 か所に置くのが要点。閲覧 (MarkdownView)・一覧プレビュー
// (NotePreviewThumb)・編集チップ (attachmentChip) の 3 か所が同じ alt を
// 読むので、片方だけ古いと同じノートが場所によって違う名前で出る。

// alt 末尾の "|数字" を表示幅 (px) として解釈する独自記法
// (例: ![スクショ|200](/api/images/x.png))。生 HTML を無効にしたまま画像ごとに
// 幅を指定できるようにするため。剥がしたラベルはチップの表示名にも使う。
export function parseAltWidth(alt: string | undefined): {
  label: string
  width: number | null
} {
  const match = /^(.*?)\|(\d+)$/.exec(alt ?? '')
  return match
    ? { label: match[1], width: Number(match[2]) }
    : { label: alt ?? '', width: null }
}
