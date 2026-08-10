// 編集画面のライブプレビューで、画像記法を「何の添付か判るチップ」として
// 描くための表示情報 (docs/70-編集ライブプレビュー計画.md §5)。
//
// **これが無いと添付が消える。** ライブプレビュー (@atomic-editor/editor の
// inlinePreview) は、カーソルの無い行の `![alt](url)` を**丸ごと隠す** —
// 画像そのものは別の拡張 (imageBlocks) が行の下に描く前提だから。
// ところがこの本文の画像記法は画像専用ではなく、音声・動画・PDF・テキストの
// 添付と、シークレット (docs/51-部分暗号化計画.md) が同じ記法に相乗りしている。
// imageBlocks をそのまま使うと、音声 URL を <img> として描いて割れた画像になり、
// シークレットに至っては暗号文を取りに行く。かといって何も描かないと、
// 記法が隠されたまま何も出ず、**添付を消したように見える**。
//
// そこで imageBlocks の代わりに自前のチップを描く。ここは種別 → 見た目の
// 対応だけを持つ純関数で、DOM を組む側 (attachmentBlocks.ts) と分けてある
// (vitest が node 環境のため)。

import { classifyImgSrc } from './imgSrcKind'
import { DEFAULT_SECRET_LABEL } from './secrets'

// alt が空のときに出す種別の名前。MarkdownView の既定ラベルと揃える
// (閲覧と編集で同じものが同じ名前で呼ばれる)
const KIND_FALLBACK_LABEL: Record<AttachmentChipKind, string> = {
  image: '画像',
  audio: '音声',
  video: '動画',
  pdf: 'PDF',
  text: 'テキスト',
  secret: DEFAULT_SECRET_LABEL,
}

// チップの絵文字。SVG アイコン (MenuIcons) を使わないのは、ここが React の
// 外 (CodeMirror の WidgetType が組む素の DOM) だから。1 文字で済むものに
// createRoot を持ち込むと、widget ごとに React ツリーを抱えることになる
const KIND_GLYPH: Record<AttachmentChipKind, string> = {
  image: '🖼',
  audio: '🎵',
  video: '🎬',
  pdf: '📄',
  text: '📝',
  secret: '🔒',
}

export type AttachmentChipKind =
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'text'
  | 'secret'

export interface AttachmentChip {
  kind: AttachmentChipKind
  // チップに出す文字 (alt が空なら種別の名前)
  label: string
  // 画像だけ実物を出す。それ以外は null (取りに行かせない)。
  // **シークレットで null なのが要点** — 中身は暗号文で、<img> に渡すと
  // 割れた画像になるうえ、断片を無駄に取得しに行く
  thumbnailUrl: string | null
  glyph: string
}

// 画像記法 1 つぶんの表示情報を作る。alt の幅指定 (`![図|200](url)`) は
// ここでは剥がさない — チップは実寸で出さないので幅は使い道がなく、
// 剥がす規則 (parseAltWidth) は Server Component 側にあるため
export function attachmentChip(src: string, alt: string): AttachmentChip {
  const cls = classifyImgSrc(src)
  const kind: AttachmentChipKind = cls.kind
  const trimmed = alt.trim()
  return {
    kind,
    label: trimmed.length > 0 ? trimmed : KIND_FALLBACK_LABEL[kind],
    thumbnailUrl: kind === 'image' ? src : null,
    glyph: KIND_GLYPH[kind],
  }
}
