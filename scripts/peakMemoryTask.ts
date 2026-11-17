// 重い処理を 1 つだけ流す (docs/127 §3)。scripts/profilePeakMemory.sh が
// 処理ごとに新しいプロセスで呼び、`/usr/bin/time -v` で子孫 (TeX の描画は
// 子プロセス) まで含めたピーク RSS を取る。ここは処理の前後の自分の数字を
// 1 行の JSON で stdout に出す。
//
//   npx tsx --conditions=react-server scripts/peakMemoryTask.ts <task>
//
// 材料はすべて固定 (benchFixture・決まった種のノイズ画像・決まった中身の ZIP)。
// DB には触れない
import { zipSync } from 'fflate'
import { BENCH_FIXTURE_MD } from '../src/lib/diag/benchFixture'
import { parseBatch } from '../src/lib/diag/parseBench'
import { makeNoiseJpeg } from '../src/lib/diag/noiseJpeg'
import { renderCircuit } from '../src/lib/circuit/circuitikz'
import { makeThumbnail } from '../src/lib/images/thumbnail'
import { readZipStream } from '../src/lib/zip/readZip'

const MB = 1024 * 1024
// スマホの写真の原寸 (12MP)
const PHOTO_WIDTH = 4032
const PHOTO_HEIGHT = 3024
// ZIP の材料: 1MB の項目を 64 個 (取り込みの典型より重めの側)
const ZIP_ENTRIES = 64
const ZIP_ENTRY_BYTES = MB
const ZIP_CHUNK_BYTES = 64 * 1024
const PARSE_REPEAT = 10

function circuitikzSource(): string {
  const match = /```circuitikz\n([\s\S]*?)```/.exec(BENCH_FIXTURE_MD)
  if (!match) {
    throw new Error('見本に circuitikz のフェンスが無い')
  }
  return match[1]
}

// 決まった種の擬似乱数で埋める (圧縮が効きすぎないように)
function fixedBytes(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size)
  let state = seed >>> 0
  for (let i = 0; i < size; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    bytes[i] = state >>> 24
  }
  return bytes
}

async function* chunksOf(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += ZIP_CHUNK_BYTES) {
    yield bytes.subarray(offset, offset + ZIP_CHUNK_BYTES)
  }
}

const TASKS: Record<string, () => Promise<string>> = {
  // 読み込みだけの基準 (他の行からこれを引くと処理そのものの分になる)
  noop: async () => 'import のみ',
  parse: async () => {
    const r = await parseBatch(Array.from({ length: PARSE_REPEAT }, () => BENCH_FIXTURE_MD))
    return `見本 × ${PARSE_REPEAT}・${r.fences} 図`
  },
  thumb: async () => {
    const jpeg = await makeNoiseJpeg(PHOTO_WIDTH, PHOTO_HEIGHT)
    const thumb = await makeThumbnail(jpeg, 'peak')
    return `${PHOTO_WIDTH}×${PHOTO_HEIGHT} ${(jpeg.byteLength / MB).toFixed(1)}MB → ${Math.round((thumb?.byteLength ?? 0) / 1024)}KB`
  },
  tex: async () => {
    const svg = await renderCircuit(circuitikzSource())
    return `circuitikz → SVG ${Math.round(svg.length / 1024)}KB`
  },
  zip: async () => {
    const files = Object.fromEntries(
      Array.from({ length: ZIP_ENTRIES }, (_, i) => [`f${i}.bin`, fixedBytes(ZIP_ENTRY_BYTES, i + 1)]),
    )
    const zip = zipSync(files, { level: 6 })
    let entries = 0
    await readZipStream(chunksOf(zip), async () => {
      entries += 1
    })
    return `${entries} 項目・${(zip.byteLength / MB).toFixed(0)}MB`
  },
}

async function main(): Promise<void> {
  const name = process.argv[2] ?? ''
  const task = TASKS[name]
  if (!task) {
    console.error(`使い方: peakMemoryTask.ts <${Object.keys(TASKS).join('|')}>`)
    process.exit(2)
  }
  const before = process.memoryUsage().rss
  const started = performance.now()
  const scale = await task()
  const ms = performance.now() - started
  const usage = process.memoryUsage()
  console.log(
    JSON.stringify({
      task: name,
      scale,
      ms: Math.round(ms),
      rssBeforeMB: Math.round(before / MB),
      rssAfterMB: Math.round(usage.rss / MB),
      selfMaxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
      heapUsedMB: Math.round(usage.heapUsed / MB),
      externalMB: Math.round(usage.external / MB),
    }),
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
