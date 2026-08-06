// 項目の並びを ZIP のバイト列へ流し込む (docs/28-エクスポート計画.md §7)。
//
// **ZIP の箱は自前で書く** (fflate の Zip クラスは使わない)。fflate の
// ストリーミング書き出しはローカルヘッダにサイズを書かず「データ記述子」方式に
// なるが、この形は**無圧縮の項目の終端が自己記述されない** — 読み手は本文の
// 中から次のシグネチャ (PK\x03\x04 等) を走査して枠を切るしかなく、添付の
// 中身に偶然同じ 4 バイトが埋まっているとそこで枠がずれて壊れる。実データで
// 実際に踏んだ (PNG 1 枚の 4.7MB 地点に PK\x03\x04 が埋まっていて、書き出した
// ZIP を自分の取り込みが読めなかった。展開ツールは中央ディレクトリから読む
// ので開けてしまい、気づきにくい)。
//
// ここでは項目の中身を丸ごと持ってから書くので、**CRC とサイズを先に計算して
// ローカルヘッダに書ける**。読み手 (fflate の Unzip を含む) はヘッダの
// サイズどおりにバイトを数えるだけになり、走査が要らない = 中身に何が
// 埋まっていても枠はずれない。取り込み側の ZIP 爆弾 1 段目 (名乗りサイズでの
// 事前拒否) も、自分の書き出しに対して効くようになる。
//
// 全件をメモリに載せない設計は従来どおり。項目を 1 件ずつ受け取り、読み手が
// 引いた分だけ先へ進む (pull 1 回 = 項目 1 件)。溜まるのは中央ディレクトリの
// 記録 (1 件 ~100 バイト) だけ。
//
// 対応しない形式は明示しておく: ZIP64 (合計 4GB 超・1 項目 4GB 超) は
// 書けない。u32 の器に収まらなくなった時点で**黙って壊れたファイルを作らず**
// 失敗させる。全件バックアップは pg_dump の担当 (§冒頭) なので、ここが
// 4GB を超える日が来たら分割エクスポートを設計する。

import { deflateRawSync, crc32 } from 'node:zlib'

export interface ZipEntry {
  // ZIP の中でのパス (layout.ts が組み立てたもの)
  path: string
  data: Uint8Array
  // 縮めるか。既に圧縮されている添付 (jpg/webp/mp4/pdf) は false —
  // CPU を使って 1% も縮まないうえ、deflate の枠 (数バイト/64KB) だけ増える
  compress: boolean
  // ファイルの更新日時。手元に展開したとき元の更新順が残る
  mtime?: Date
}

const U32_MAX = 0xffffffff
// 汎用フラグ: bit 11 (UTF-8 のファイル名) だけ立てる。データ記述子 (bit 3) は
// **立てない** — サイズをヘッダに書くのがこのライタの存在理由
const FLAG_UTF8 = 0x0800
const METHOD_STORED = 0
const METHOD_DEFLATE = 8

interface CentralRecord {
  nameBytes: Uint8Array
  method: number
  crc: number
  compressedSize: number
  originalSize: number
  offset: number
  dosTime: number
  dosDate: number
}

export function createZipStream(
  entries: AsyncIterable<ZipEntry>,
): ReadableStream<Uint8Array> {
  const source = entries[Symbol.asyncIterator]()
  const central: CentralRecord[] = []
  let offset = 0

  return new ReadableStream<Uint8Array>({
    // pull は「まだ引ける」と読み手が言ったときだけ呼ばれる。1 回につき
    // 1 項目しか進めないことが、そのまま背圧になる (次を DB から取りに行く
    // のは、いま入れたぶんが掃けてから)
    async pull(controller) {
      const next = await source.next()
      if (next.done) {
        controller.enqueue(centralDirectory(central, offset))
        controller.close()
        return
      }

      const entry = next.value
      const nameBytes = new TextEncoder().encode(entry.path)
      const { method, payload } = encodePayload(entry)
      const crc = crc32(entry.data)
      const [dosTime, dosDate] = dosDateTime(entry.mtime)

      const record: CentralRecord = {
        nameBytes,
        method,
        crc,
        compressedSize: payload.byteLength,
        originalSize: entry.data.byteLength,
        offset,
        dosTime,
        dosDate,
      }
      // 書く前に器に収まるか確かめる。超えてから気づくと、途中までの
      // ダウンロードが「開けるが途中で欠けた ZIP」として手元に残る
      if (
        record.originalSize > U32_MAX ||
        offset + 30 + nameBytes.byteLength + payload.byteLength > U32_MAX
      ) {
        throw new Error(
          'ZIP が 4GB を超えるため書き出せません (ZIP64 は未対応)。選択エクスポートで分けて下さい',
        )
      }

      const header = localHeader(record)
      controller.enqueue(header)
      controller.enqueue(payload)
      offset += header.byteLength + payload.byteLength
      central.push(record)
    },

    async cancel() {
      // 利用者がダウンロードを中断した。DB のカーソルを開いたままにしない。
      // 使い切ったジェネレータへの return は何もしないので、場合分けは要らない
      await source.return?.()
    },
  })
}

// 縮める判断。deflate して逆に太る入力 (乱数に近い小さなデータ) は素通しに
// 倒す — 読む側はヘッダの method に従うだけなので、どちらでも読める
function encodePayload(entry: ZipEntry): { method: number; payload: Uint8Array } {
  if (!entry.compress) {
    return { method: METHOD_STORED, payload: entry.data }
  }
  const deflated = deflateRawSync(entry.data, { level: 6 })
  return deflated.byteLength < entry.data.byteLength
    ? { method: METHOD_DEFLATE, payload: deflated }
    : { method: METHOD_STORED, payload: entry.data }
}

// ローカルファイルヘッダ (30 バイト + 名前)。サイズと CRC を**ここに書く**
function localHeader(record: CentralRecord): Uint8Array {
  const bytes = new Uint8Array(30 + record.nameBytes.byteLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true) // 展開に要するバージョン (2.0 = deflate)
  view.setUint16(6, FLAG_UTF8, true)
  view.setUint16(8, record.method, true)
  view.setUint16(10, record.dosTime, true)
  view.setUint16(12, record.dosDate, true)
  view.setUint32(14, record.crc, true)
  view.setUint32(18, record.compressedSize, true)
  view.setUint32(22, record.originalSize, true)
  view.setUint16(26, record.nameBytes.byteLength, true)
  view.setUint16(28, 0, true) // extra なし
  bytes.set(record.nameBytes, 30)
  return bytes
}

// 中央ディレクトリ + 終端レコード。展開ツールの多く (エクスプローラ・Files
// アプリ) はこちらを正として読む
function centralDirectory(records: CentralRecord[], startOffset: number): Uint8Array {
  const size = records.reduce((sum, r) => sum + 46 + r.nameBytes.byteLength, 0)
  const bytes = new Uint8Array(size + 22)
  const view = new DataView(bytes.buffer)
  let at = 0
  for (const record of records) {
    view.setUint32(at, 0x02014b50, true)
    view.setUint16(at + 4, 20, true) // 作成側バージョン
    view.setUint16(at + 6, 20, true) // 展開に要するバージョン
    view.setUint16(at + 8, FLAG_UTF8, true)
    view.setUint16(at + 10, record.method, true)
    view.setUint16(at + 12, record.dosTime, true)
    view.setUint16(at + 14, record.dosDate, true)
    view.setUint32(at + 16, record.crc, true)
    view.setUint32(at + 20, record.compressedSize, true)
    view.setUint32(at + 24, record.originalSize, true)
    view.setUint16(at + 28, record.nameBytes.byteLength, true)
    // extra / comment / disk / 内部属性 / 外部属性 = 0 (確保時にゼロ済み)
    view.setUint32(at + 42, record.offset, true)
    bytes.set(record.nameBytes, at + 46)
    at += 46 + record.nameBytes.byteLength
  }
  // End of central directory
  view.setUint32(at, 0x06054b50, true)
  view.setUint16(at + 8, records.length, true)
  view.setUint16(at + 10, records.length, true)
  view.setUint32(at + 12, size, true)
  view.setUint32(at + 16, startOffset, true)
  return bytes
}

// DOS 形式の日時 (2 秒精度・ローカル時刻)。1980 年より前は表せないので
// 底に丸める。無ければ底 (1980-01-01) — 「書き出した時刻」を入れると
// 同じ内容から違うバイト列ができて、比較やテストが不安定になる
function dosDateTime(mtime: Date | undefined): [number, number] {
  if (!mtime || mtime.getFullYear() < 1980) {
    return [0, 0x21] // 1980-01-01 00:00:00
  }
  const time =
    (mtime.getHours() << 11) | (mtime.getMinutes() << 5) | (mtime.getSeconds() >> 1)
  const date =
    ((mtime.getFullYear() - 1980) << 9) | ((mtime.getMonth() + 1) << 5) | mtime.getDate()
  return [time, date]
}
