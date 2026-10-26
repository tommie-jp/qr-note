// サーバクリップボードの見本の絵を、送るファイルからブラウザで作る (docs/115 §1-2)。
// **クライアント専用。**
//
// サーバに ffmpeg も pdf.js も持ち込まない (docs/14・docs/72 の判断) ので、動画の先頭コマと
// PDF の 1 ページ目はブラウザで描いて、本体を置いた後に別の口 (api/clipboard/thumb) で貼る。
// サーバは受けた絵を makeThumbnail で作り直すので、ここは「送る量を抑える前処理」で
// よく、形式も寸法も厳密でなくてよい。
//
// **失敗しても投げない** (null)。見本は派生物 (videoPoster.ts と同じ流儀)。
// **sharp を import しないこと** (videoPoster.ts の注。クライアントの束に fs が混ざる)。
// pdf.js (数 MB) は PDF を送るときだけ import() で読む。

import { redrawImage } from '../images/imageCanvas'
import type { ClipboardSlotKind } from './slot'

// 見本の長辺 (px)。サーバの THUMB_MAX_PX と揃える (sharp を引き込まないため独立した定数)
const THUMB_EDGE_PX = 384
// サーバの上限 (MAX_VIDEO_THUMB_BYTES = 200KB) に余裕を持って収める
const THUMB_QUALITY = 0.8
// JPEG は透過を持てない。PDF の透明な背景を白で埋める
const THUMB_BACKGROUND = '#ffffff'

export interface ClientThumbDeps {
  readonly videoPoster: (file: File) => Promise<Blob | null>
  readonly pdfFirstPage: (file: File) => Promise<Blob | null>
}

export function browserThumbDeps(): ClientThumbDeps {
  return {
    videoPoster: async (file) => {
      const { makeVideoThumbs } = await import('../video/videoPoster')
      return (await makeVideoThumbs(file, { withFrames: false })).poster
    },
    pdfFirstPage,
  }
}

// 種類に応じて見本の絵を作る。動画と PDF のほかはサーバが作る (または札で足りる) ので null
export async function makeClientThumb(
  file: File,
  kind: ClipboardSlotKind,
  deps: ClientThumbDeps = browserThumbDeps(),
): Promise<Blob | null> {
  try {
    if (kind === 'video') {
      return await deps.videoPoster(file)
    }
    if (kind === 'pdf') {
      return await deps.pdfFirstPage(file)
    }
    return null
  } catch (error) {
    console.error('クリップボードの見本の絵を作れませんでした:', error)
    return null
  }
}

// PDF の 1 ページ目を描く。描いた canvas は長辺 384 の JPEG に描き直して返す
async function pdfFirstPage(file: File): Promise<Blob | null> {
  if (typeof document === 'undefined') {
    return null
  }
  const { loadPdfDocument } = await import('../../components/pdf/pdfService')
  const url = URL.createObjectURL(file)
  try {
    const doc = await loadPdfDocument(url)
    try {
      const { width, height } = await doc.pageSize(1)
      const canvas = document.createElement('canvas')
      // 横長のページでも長辺が 384 になる幅で描く (renderPage は幅に合わせる)
      const cssWidth = width >= height ? THUMB_EDGE_PX : (THUMB_EDGE_PX * width) / height
      await doc.renderPage(1, canvas, Math.max(1, Math.round(cssWidth)))
      const drawn = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (drawn === null) {
        return null
      }
      return await redrawImage(drawn, {
        type: 'image/jpeg',
        quality: THUMB_QUALITY,
        maxEdge: THUMB_EDGE_PX,
        background: THUMB_BACKGROUND,
      })
    } finally {
      // worker ごと破棄する (wasm ヒープは縮まない。pdfService.ts の destroy の注)
      await doc.destroy()
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
