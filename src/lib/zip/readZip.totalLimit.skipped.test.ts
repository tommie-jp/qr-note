import { zipSync } from 'fflate'
import { expect, test } from 'vitest'
import { chunkedBytes } from '@/lib/bytes'
import { MAX_ZIP_FILE_BYTES, MAX_ZIP_TOTAL_BYTES } from './limits'
import { readZipStream } from './readZip'

// 読まない項目 (ZipReadOptions.accept が false を返したもの) も展開後の合計に
// 数えること。読む側の門は readZip.totalLimit.test.ts、読み取りの他のテストは
// readZip.test.ts にある。
//
// 別ファイルなのは、こちらも 1GB を deflate する 8 秒級のテストで、隣に
// 置くと 2 本ぶんの待ちが直列に積み上がるため (理由の詳しくは
// readZip.totalLimit.test.ts のヘッダ / docs/80-デプロイ再高速化計画.md §9)。

// 捨てるにせよ展開はしている。際限なく付き合わないための歯止めは残す
test('読まない項目も展開後の合計には数える', async () => {
  const chunk = new Uint8Array(MAX_ZIP_FILE_BYTES - 1)
  const files: Record<string, Uint8Array> = {}
  for (let index = 0; index * (MAX_ZIP_FILE_BYTES - 1) <= MAX_ZIP_TOTAL_BYTES; index += 1) {
    files[`junk/${index}.bin`] = chunk
  }

  await expect(
    readZipStream(chunkedBytes(zipSync(files)), async () => {}, { accept: () => false }),
  ).rejects.toThrow(/展開後の合計が大きすぎます/)
}, 60000)
