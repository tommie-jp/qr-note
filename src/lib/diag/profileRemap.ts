// CPU プロファイルの束ねの位置を、元のモジュールへ引き直す (docs/122 §4)。
//
// 本番ビルドのサーバコードは .next/server/chunks/ に束ねられ、モジュール名が
// 残らない (Turbopack は数字の id)。束ねの隣の .map (Dockerfile が解析の道の物だけ
// 運ぶ。scripts/copyProfileMaps.mjs) で、各 callFrame の url・行・関数名を元へ
// 置き換える。.map が無い束ねはそのまま (落とさない)。元の url は bundleUrl に残す。
//
// Node 標準の node:module の SourceMap を使う (依存を増やさない)。純粋な部分
// (moduleOf・summarizeByModule) は葉で、map の読み出しだけを引数で受ける
import { SourceMap } from 'node:module'

export interface CallFrame {
  functionName: string
  scriptId: string
  url: string
  lineNumber: number
  columnNumber: number
  // 引き直す前の束ねの url (引き直したときだけ)
  bundleUrl?: string
}

export interface ProfileNode {
  id: number
  callFrame: CallFrame
  hitCount?: number
  children?: number[]
  positionTicks?: unknown
}

export interface CpuProfile {
  nodes: ProfileNode[]
  startTime: number
  endTime: number
  samples?: number[]
  timeDeltas?: number[]
}

export type ReadSourceMap = (bundleUrl: string) => SourceMap | null

// 元のパス (`../../../../node_modules/micromark/lib/x.js`・`file:///…`) をモジュールの
// 名前に畳む。node_modules は入れ子なら一番内側のパッケージ、src は上から 3 段
export function moduleOf(url: string): string {
  if (url === '') return '(V8)'
  if (url.startsWith('node:')) return 'node:'
  const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/.exec(url)
  if (pkg) return pkg[1]
  const src = /(?:^|\/)(src\/[^/]+\/[^/]+)\//.exec(url)
  if (src) return src[1]
  if (url.includes('/.next/server/chunks/')) return '(束ね・引き直せず)'
  return url.split('/').slice(-2).join('/')
}

// 束ねの url ごとに 1 度だけ map を読む
function cachedReader(read: ReadSourceMap): ReadSourceMap {
  const cache = new Map<string, SourceMap | null>()
  return (url) => {
    if (!cache.has(url)) cache.set(url, read(url))
    return cache.get(url) ?? null
  }
}

// 縮めた 1〜2 文字の名前 (`h`・`b`) は元の名前に替える。@types/node の型には
// name が無いが、Node は findEntry の戻りに載せる
function originalName(bundled: string, entry: object): string {
  const name = (entry as { name?: unknown }).name
  return (bundled === '' || bundled.length <= 2) && typeof name === 'string' && name !== '' ? name : bundled
}

export function remapProfile(profile: CpuProfile, read: ReadSourceMap): CpuProfile {
  const readMap = cachedReader(read)
  const nodes = profile.nodes.map((node) => {
    const frame = node.callFrame
    if (!frame.url.includes('/.next/server/') || frame.lineNumber < 0) {
      return node
    }
    const map = readMap(frame.url)
    const entry = map?.findEntry(frame.lineNumber, frame.columnNumber)
    if (!entry || !('originalSource' in entry) || !entry.originalSource) {
      return node
    }
    return {
      ...node,
      callFrame: {
        ...frame,
        url: entry.originalSource,
        lineNumber: entry.originalLine,
        columnNumber: entry.originalColumn,
        functionName: originalName(frame.functionName, entry),
        bundleUrl: frame.url,
      },
    }
  })
  return { ...profile, nodes }
}

export interface ModuleTime {
  module: string
  ms: number
  pct: number
}

// モジュールごとの自己時間 (多い順)。最初のサンプルまでの待ち (プロファイラの起動) は入れない
export function summarizeByModule(profile: CpuProfile, top = 12): ModuleTime[] {
  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []
  const urlOf = new Map(profile.nodes.map((node) => [node.id, node.callFrame.url]))
  const byModule = new Map<string, number>()
  let total = 0
  samples.forEach((id, index) => {
    if (index === 0) return
    const us = deltas[index] ?? 0
    const name = moduleOf(urlOf.get(id) ?? '')
    byModule.set(name, (byModule.get(name) ?? 0) + us)
    total += us
  })
  return [...byModule]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([module, us]) => ({
      module,
      ms: Math.round(us / 100) / 10,
      pct: total === 0 ? 0 : Math.round((us / total) * 1000) / 10,
    }))
}
