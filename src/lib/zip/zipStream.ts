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
  // fflate の ondata は add / push / end の中から**同期で**飛ぶので、
  // 受け取ったチャンクはその場で controller へ渡せる (溜め place は要らない)
  let controller: ReadableStreamDefaultController<Uint8Array>
  let failure: Error | null = null

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      // 壊れた ZIP を「正常な応答」として配らない。次の pull で投げ、
      // ダウンロードは途中で失敗する (不完全なファイルが残らない)
      failure = error
      return
    }
    controller.enqueue(chunk)
    if (final) {
      controller.close()
    }
  })

  return new ReadableStream<Uint8Array>({
    start(source_) {
      controller = source_
    },

    // pull は「まだ引ける」と読み手が言ったときだけ呼ばれる。1 回につき
    // 1 項目しか進めないことが、そのまま背圧になる (次を DB から取りに行く
    // のは、いま入れたぶんが掃けてから)
    async pull() {
      if (failure !== null) {
        throw failure
      }
      const next = await source.next()
      if (next.done) {
        // 中央ディレクトリを書いて閉じる (ondata が final で飛ぶ)
        zip.end()
        return
      }
      addEntry(zip, next.value)
      if (failure !== null) {
        throw failure
      }
    },

    async cancel() {
      // 利用者がダウンロードを中断した。DB のカーソルを開いたままにしない。
      // 使い切ったジェネレータへの return は何もしないので、場合分けは要らない
      await source.return?.()
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
