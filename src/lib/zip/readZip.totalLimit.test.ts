import { zipSync } from 'fflate'
import { expect, test } from 'vitest'
import { chunkedBytes } from '@/lib/bytes'
import { MAX_ZIP_FILE_BYTES, MAX_ZIP_TOTAL_BYTES } from './limits'
import { readZipStream } from './readZip'

// 展開後の合計 (MAX_ZIP_TOTAL_BYTES = 1GB) の門。読み取りの他のテストは
// readZip.test.ts にある。
//
// **別ファイルにしてあるのは速さのため。** 上限を超えさせるには 1GB を
// zipSync に食わせるしかなく (1 項目あたりの上限が 50MB なので 21 項目)、
// deflate だけで 8 秒かかる。vitest はファイル単位で並列化するので、同じく
// 1GB を要する readZip.totalLimit.skipped.test.ts とは別ファイルに置くと
// 2 本が同時に走り、テスト全体の所要が 19 秒ぶんではなく 10 秒ぶんで済む。
// これは ./doDeploy.sh の 3/8 (lint / test / build を並列に流す区間) の
// 律速に効く (docs/80-デプロイ再高速化計画.md §9)。
//
// ゼロ埋めを圧縮率で誤魔化すことはできない — level 1 でも 0 でも実測は
// 縮まなかった (level 0 は 1GB の ZIP がメモリに載る)。

// 名乗らない ZIP (このアプリの書き出しもデータ記述子を使うので名乗らない) は
// 出てきたバイト数で数えて断つ
test('合計が上限を超えたら投げる', async () => {
  const chunk = new Uint8Array(MAX_ZIP_FILE_BYTES - 1)
  const files: Record<string, Uint8Array> = {}
  for (let index = 0; index * (MAX_ZIP_FILE_BYTES - 1) <= MAX_ZIP_TOTAL_BYTES; index += 1) {
    files[`images/${index}.jpg`] = chunk
  }

  await expect(
    readZipStream(chunkedBytes(zipSync(files)), async () => {}),
  ).rejects.toThrow(/合計が大きすぎ/)
}, 60000)
