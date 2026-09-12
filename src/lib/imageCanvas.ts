// ラスタ画像を canvas で描き直す (縮小・形式変換)。**クライアント専用** —
// document を触るのでサーバ側から import しないこと。
//
// サーバには sharp があり (thumbnail.ts / normalizeImage.ts)、通常の添付は
// そちらで直している。ここが要るのは「サーバへ渡す前に直さないといけない」
// 場面で、今のところ 3 つある:
//
//   1. シークレットの画像 (docs/51 §9) — サーバは暗号文しか見られない
//   2. クリップボードから取り込む画像 (docs/92 §4) — PNG で来ると上限を超える
//   3. クリップボードへ書き出す画像 (docs/92 §3) — Chrome は png しか受けない
//
// 3 つとも「読む → 収める大きさを決める → 描く → 書き出す」で同じなので、
// 1 本にまとめてある。副産物として EXIF (撮影場所・日時) が落ちる。

export interface RedrawOptions {
  // 書き出す形式。**出せない環境では canvas が黙って別形式を返す** (古い iOS
  // Safari は WebP を書き出せない) ので、要るなら呼ぶ側が blob.type を確かめる
  type: string
  quality?: number
  // 長辺の上限 (px)。null なら原寸のまま
  maxEdge?: number | null
  // 透過を潰す下地の色。JPEG は透過を持てず、指定しないと透明部分が黒くなる
  background?: string | null
}

// 長辺を limit に収めた大きさ (縦横比は保つ)。0 にはしない。
export function fitWithin(
  width: number,
  height: number,
  limit: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= limit) {
    return { width, height }
  }
  const scale = limit / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// 画像を読み、指定の大きさ・形式で描き直したバイト列を返す。
// 読めない形式 (HEIC を復号できないブラウザなど) は例外を投げる。
export async function redrawImage(
  source: Blob,
  { type, quality, maxEdge = null, background = null }: RedrawOptions,
): Promise<Blob> {
  const bitmap = await decode(source)
  try {
    const { width, height } =
      maxEdge === null
        ? { width: bitmap.width, height: bitmap.height }
        : fitWithin(bitmap.width, bitmap.height, maxEdge)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('画像を変換できませんでした')
    }
    if (background !== null) {
      context.fillStyle = background
      context.fillRect(0, 0, width, height)
    }
    context.drawImage(bitmap, 0, 0, width, height)

    return await canvasToBlob(canvas, type, quality)
  } finally {
    bitmap.close()
  }
}

async function decode(source: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(source)
  } catch (cause) {
    console.error('画像を読み取れませんでした', cause)
    // HEIC は iOS Safari 以外では復号できない。ここは**サーバ変換に頼れない**
    // 経路なので、正直に断る (黙って壊れた画像を渡さない)
    throw new Error(
      'この画像を読み取れませんでした。別の形式 (JPEG / PNG) でお試しください',
    )
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number | undefined,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error('画像を変換できませんでした'))
          return
        }
        resolve(blob)
      },
      type,
      quality,
    )
  })
}
