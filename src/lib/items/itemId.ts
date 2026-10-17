// 新規ノートの id (docs/107-ノート主キー計画.md §2-1)。UUID v7 (RFC 9562)。
//
// 先頭 48 bit がミリ秒の時刻なので、id 順 = 作った順になる。並び順「登録順」は
// この性質だけに頼っている (prefs/sortOrder.ts)。
//
// **同じミリ秒の中でも単調に増やす**のが要点。ENEX / ZIP の取り込みは 1 ミリ秒に
// 何件も振るので、乱数のままだと取り込み順が登録順に出ない。RFC 9562 §6.2 の
// 方法 1 に倣い、rand_a (12 bit) を同じミリ秒の中の連番にする。連番が溢れたら
// 時刻のほうを 1 ms 進める (時計より先に出るが、順は崩れない)。
//
// DB の既定値 (PostgreSQL 18 の uuidv7()) とも同じ形で、どちらが振っても混ざって
// 並ぶ。crypto.randomUUID() は v4 (全部乱数) なので使わない。
// 純関数ではないが DB に触らないので、クライアント (オフライン作成) からも呼べる

const SEQ_MAX = 0xfff
// 新しいミリ秒の連番の始まり。上半分を空けておき、同じミリ秒で溢れにくくする
const SEQ_START_MAX = 0x7ff

let lastMs = -1
let seq = 0

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function newItemId(now: number = Date.now()): string {
  let ms = Math.max(now, lastMs)
  if (ms === lastMs) {
    seq++
    if (seq > SEQ_MAX) {
      ms++
      seq = 0
    }
  } else {
    const [hi, lo] = randomBytes(2)
    seq = ((hi << 8) | lo) & SEQ_START_MAX
  }
  lastMs = ms

  const bytes = randomBytes(16)
  // 48 bit の時刻 (big endian)。ビット演算は 32 bit なので割り算で切り出す
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256
    ms = Math.floor(ms / 256)
  }
  bytes[6] = 0x70 | (seq >> 8) // 版 7 + 連番の上位 4 bit
  bytes[7] = seq & 0xff
  bytes[8] = 0x80 | (bytes[8] & 0x3f) // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
