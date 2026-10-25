// リクエスト本文を、上限を守りながら読む。
//
// request.arrayBuffer() / json() は全部読み終えてから大きさを測れる。Content-Length を
// 申告しない送信 (chunked) や、申告が嘘の送信は事前検査 (uploads/request.ts) を素通りし、
// 1 人で Node のメモリを食い尽くせてしまう。ここは**読みながら数え、超えた時点で
// 読むのをやめる**。vps2 はメモリが逼迫している。

// 上限を超えたら null。本文が無ければ空の配列
export async function readBodyBounded(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (request.body === null) {
    return new Uint8Array(0)
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > maxBytes) {
      // 残りを受け取らない。cancel の失敗は(既に切れている等)握り潰してよい
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}
