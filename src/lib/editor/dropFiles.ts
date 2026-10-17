// 編集画面へのドロップで「何が落ちてきたか」を決める判定 (docs/105-画像ドロップ計画.md)。
//
// ブラウザに依存しない純粋関数だけを置く。`text/html` から `<img src>` を
// 抜く処理は DOMParser が要るので、呼ぶ側 (hooks/useAttachmentInsert.ts) に置く

// ドラッグ中の中身にファイルが含まれるか。dragover の間は getData も files も
// 読めない (保護モード) ので、types だけで決める。Windows のエクスプローラから
// 引いたファイルは "Files" を持つ
export function hasDroppedFiles(
  types: ArrayLike<string> | null | undefined,
): boolean {
  return Array.from(types ?? []).includes('Files')
}

// ドロップを受けるか (dragover で preventDefault するか) の判定。ファイルと、
// 画像かもしれない URL (別のタブの画像を引っ張った形) の 2 つを受ける。
// URL が画像かどうかは drop まで読めないので、ここでは受けておく
export function acceptsDrop(types: ArrayLike<string> | null | undefined): boolean {
  const list = Array.from(types ?? [])
  return list.includes('Files') || list.includes('text/uri-list')
}

// ブラウザがそのまま表示できる画像の拡張子。HEIC・TIFF は外部 URL のままでは
// 表示されないので含めない (アップロードならサーバが WebP へ変換する)
const WEB_IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp)$/i

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

// text/uri-list の最初の URL。`#` で始まる行はコメント (RFC 2483)
function firstUri(uriList: string): string | null {
  const line = uriList
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0 && !s.startsWith('#'))
  return line ?? null
}

export interface DroppedLinks {
  // dataTransfer.getData('text/uri-list')
  uriList: string
  // text/html の最初の <img> の src (無ければ null)
  imgSrc: string | null
}

// ドロップされた外部画像の URL を返す (画像でなければ null)。
//
// - `<img>` を引っ張ったときは text/html に <img src> が入る。拡張子の無い
//   画像 (CDN の `?w=800` 形式など) もこちらで拾える
// - <img> が無ければ uri-list の URL を、画像の拡張子を持つときだけ採る。
//   普通のリンクのドロップは従来どおり文字として入れる (null を返す)
// - **同じオリジンは採らない。** 本文の中の添付画像を引いて動かすときも
//   ブラウザは <img> の URL を載せる。それを拾うと、移動のはずが
//   `http://…/api/images/…` の絶対 URL の複製になる
// - data: / blob: は採らない (本文に巨大な文字列や、閉じると消える URL が残る)
export function droppedImageUrl(
  links: DroppedLinks,
  ownOrigin: string,
): string | null {
  const fromImg = links.imgSrc === null ? null : parseHttpUrl(links.imgSrc)
  const uri = firstUri(links.uriList)
  const fromUri = uri === null ? null : parseHttpUrl(uri)
  const picked =
    fromImg ??
    (fromUri !== null && WEB_IMAGE_EXT_RE.test(fromUri.pathname)
      ? fromUri
      : null)
  if (picked === null || picked.origin === ownOrigin) {
    return null
  }
  return picked.href
}

// 外部画像の記法。URL の丸括弧は記法の終わりと取り違えられるので % にする
// (空白と <> は URL#href が既に % にしている)
export function externalImageMarkup(url: string): string {
  const escaped = url.replace(/\(/g, '%28').replace(/\)/g, '%29')
  return `![](${escaped})`
}
