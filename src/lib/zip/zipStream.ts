// 項目の並びを ZIP のバイト列へ流し込む (docs/28-エクスポート計画.md §7)。
//
// **全件をメモリに載せない**のがこの層の存在理由。添付は DB の bytea にあり、
// 全ノート分を集めると数百 MB になる一方、本番 VPS は RAM 2GB / swap 常用
// (docs/09) である。項目を 1 件ずつ受け取り、読み手が引いた分だけ先へ進む。
//
// 圧縮は同期版 (ZipDeflate) を使う。Node は 1 本のイベントループなので重い同期
// 処理は避けたいが、縮めるのは 1 件 10KB 以下の Markdown だけで、数 MB ある
// 添付は素通し (ZipPassThrough) にしてある。非同期版は ondata が後から飛ぶぶん
// 出口の順序制御が増えるので、ここでは割に合わない。

import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'

export interface ZipEntry {
  // ZIP の中でのパス (layout.ts が組み立てたもの)
  path: string
  data: Uint8Array
  // 縮めるか。既に圧縮されている添付 (jpg/webp/mp4/pdf) は false —
  // CPU を使って 1% も縮まないうえ、ピークメモリが増える
  compress: boolean
  // ファイルの更新日時。手元に展開したとき元の更新順が残る
  mtime?: Date
}

export function createZipStream(
  entries: AsyncIterable<ZipEntry>,
): ReadableStream<Uint8Array> {
  const source = entries[Symbol.asyncIterator]()

  // fflate は ondata でしか出力を渡してこないので、いったんここで受ける。
  // 溜まるのは「いま追加した 1 件ぶん」だけ — 次の項目を取りに行くのは
  // ここが空になってからなので、際限なく積み上がることはない
  const pending: Uint8Array[] = []
  let failure: Error | null = null
  let closed = false

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error
      return
    }
    pending.push(chunk)
    if (final) {
      closed = true
    }
  })

  let ended = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // 出せるものが無い間だけ次の項目を取りに行く。pull は読み手が引いた
      // ときにしか呼ばれないので、これがそのまま背圧になる
      while (pending.length === 0 && !closed && failure === null) {
        const next = await source.next()
        if (next.done) {
          ended = true
          // 中央ディレクトリを書いて閉じる。同期に ondata が飛ぶので、
          // 抜けた時点で pending か closed のどちらかが立っている
          zip.end()
          break
        }
        addEntry(zip, next.value)
      }

      if (failure !== null) {
        // 壊れた ZIP を「正常な応答」として配らない。ダウンロードは途中で
        // 失敗し、利用者には不完全なファイルが残らない
        throw failure
      }
      const chunk = pending.shift()
      if (chunk === undefined) {
        controller.close()
        return
      }
      controller.enqueue(chunk)
    },

    async cancel() {
      // 利用者がダウンロードを中断した。DB のカーソルを開いたままにしない
      if (!ended) {
        await source.return?.()
      }
    },
  })
}

function addEntry(zip: Zip, entry: ZipEntry): void {
  const file = entry.compress
    ? new ZipDeflate(entry.path, { level: 6 })
    : new ZipPassThrough(entry.path)
  if (entry.mtime) {
    file.mtime = entry.mtime
  }
  zip.add(file)
  // 1 件を 1 回で押し込む (true = これで最後)。ondata が同期で飛び、
  // pending にヘッダと中身が積まれる
  file.push(entry.data, true)
}
