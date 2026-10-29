// サーバの束ねの source map のうち、CPU プロファイルを取る道の物だけを standalone へ
// 写す (docs/122 §4)。Dockerfile の builder 段が next build の後に呼ぶ。
//
// next.config.ts の experimental.serverSourceMaps で束ねごとに .map が出るが、
// standalone のトレースは .map を運ばない。全部を運ぶと 56MB になり、毎配布の
// 転送と vps1 のディスク・メモリには重い。ベンチマークのプロファイル
// (lib/diag/benchProfile.ts) が引き直すのは回路フェンスの解析の道だけなので、
// その元 (sources) を含む束ねの .map だけを選ぶ。
//
// 選ぶのは、ベンチマークの画面 (計測の Server Action を含む) の入口が読む束ねの
// うち、解析の道の元 (sources) を含む物。回路やマークダウンの部品は多くのページの
// 束ねに重複して入っているので、入口で絞らないと 15MB 近くになる。
//
// 使い方: node scripts/copyProfileMaps.mjs <.next/server> <.next/standalone/.next/server>
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

// 解析の道の元。どれか 1 つでも sources に含む束ねの .map を運ぶ
const PROFILE_SOURCES = [
  '/src/lib/diag/',
  '/src/lib/markdown/',
  '/src/lib/circuit/',
  '/node_modules/micromark',
  '/node_modules/mdast-util-',
  '/node_modules/unist-util-',
  '/node_modules/remark-',
  '/node_modules/unified/',
]

// ベンチマークの入口 (page.js・route.js など)。ここが R.c("server/chunks/…") で読む束ねを
// 拾う。計測そのものは C/S 化 (docs/123) で API (/api/diag/bench) に移ったので、
// 画面だけを見ると解析の道の .map が運ばれない (docs/124 §8)
const ENTRY_DIRS = ['app/settings/benchmark', 'app/api/diag/bench']

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      yield* walk(path)
    } else if (name.endsWith('.js')) {
      yield path
    }
  }
}

const [from, to] = process.argv.slice(2)
if (!from || !to) {
  console.error('usage: node scripts/copyProfileMaps.mjs <from .next/server> <to standalone .next/server>')
  process.exit(1)
}

// 入口が読む束ね (.next/server からの相対パス)
const chunks = new Set()
for (const entryDir of ENTRY_DIRS) {
  const before = chunks.size
  for (const entry of walk(join(from, entryDir))) {
    for (const [, chunk] of readFileSync(entry, 'utf8').matchAll(/"server\/(chunks\/[^"]+\.js)"/g)) {
      chunks.add(chunk)
    }
  }
  if (chunks.size === before) {
    // 入口の形が変わった (Next の版上げなど)。黙って 0 個にせず、配布を止めて気づかせる
    console.error(`${entryDir} の入口から新しい束ねを 1 つも拾えなかった`)
    process.exit(1)
  }
}

let copied = 0
let bytes = 0
for (const chunk of chunks) {
  const path = join(from, `${chunk}.map`)
  let map
  try {
    map = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    continue
  }
  const sources = map.sources ?? []
  if (!sources.some((source) => PROFILE_SOURCES.some((part) => source.includes(part)))) {
    continue
  }
  // 元のソース全文 (sourcesContent) は落とす。引き直しに要るのは位置と名前だけで、
  // 全文が .map の大半を占める
  const { sourcesContent: _content, ...slim } = map
  const text = JSON.stringify(slim)
  const dest = join(to, relative(from, path))
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, text)
  copied += 1
  bytes += Buffer.byteLength(text)
}
console.log(`プロファイル用の source map: ${copied} 個 (${(bytes / 1024 / 1024).toFixed(1)}MB) を写した`)
