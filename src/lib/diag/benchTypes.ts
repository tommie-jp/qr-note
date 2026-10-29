// QR-Note ベンチマークの形 (docs/121-QR-Noteベンチマーク計画.md §2)。
//
// 保存 (benchStore)・計測 (serverBench / clientBenchHarvest)・表示
// (settings/benchmark) とコピー用の整形 (formatBench) が共有する。
// 状態も I/O も持たない葉なので、client からも import できる

// 計測した環境。WSL・本番・移行先の数字を並べたとき、どの機械の値かを読むため
export interface BenchEnv {
  cpuModel: string
  threads: number
  totalMemMB: number
  nodeVersion: string
  appVersion: string
  // ゴミ箱を除いたノート数と、そのうち回路フェンスを持つ数 (データ依存の行の規模)
  items: number
  circuitItems: number
  // ISO 8601
  measuredAt: string
}

export interface ServerBenchItem {
  // 'search:抵抗' | 'parse:cold' | 'parse:fixture' | 'thumb:fixture' | 'sync:payload'
  id: string
  label: string
  medianMs: number
  // 規模 ('21 件' | '20 件' | '2.3MB' など)。データ依存の行を比べるときに読む
  scale: string
  // 段階の中央値 (段階の無い項目は {})
  phases: Record<string, number>
  // 中身に依らない行 (環境どうしで直接比べられる)
  fixed: boolean
}

export interface ServerBenchResult {
  version: 1
  env: BenchEnv
  items: ServerBenchItem[]
  // 失敗した項目 (除いて保存する。黙って欠けさせない)
  failed: { id: string; message: string }[]
}

export interface ClientBenchRow {
  label: string
  value: string
}

export interface ClientBenchRun {
  version: 1
  // 'PC' | 'iPhone' (logging/clientPayload.ts の deviceLabel)
  device: string
  // '有線' | 'Wi-Fi' | 'キャリア' | '不明' (メニューの「計測開始」から流した分)
  line: string
  panes: string
  width: string
  measuredAt: string
  rows: ClientBenchRow[]
}

// 回線の種別。ブラウザには分からないので人が選ぶ (§4-2)
export const NET_LINES = ['有線', 'Wi-Fi', 'キャリア'] as const
export type NetLine = (typeof NET_LINES)[number]
export const UNKNOWN_LINE = '不明'

export function isNetLine(value: unknown): value is NetLine {
  return NET_LINES.some((line) => line === value)
}

// 走っている計測の種類 (同時に 1 本だけ。benchJob.ts)
export type BenchJobKind = 'cpu' | 'server'
