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
  // どの機械か (サーバー情報と同じ読み方。compose のマウントが無ければ null)。
  // v0.23.143 以前の保存には無い
  hostName?: string | null
  osName?: string | null
  kernel?: string
}

// 1 時点のメモリ (docs/127 §2)。MB の小数 1 桁。cgroup はコンテナ全体 (TeX の
// 子プロセスも含む) で、手元の素の node や v1 の環境では null
export interface MemorySnapshot {
  rssMB: number
  heapUsedMB: number
  heapTotalMB: number
  externalMB: number
  arrayBuffersMB: number
  // このプロセスの起動からの最大 RSS (process.resourceUsage().maxRSS)
  maxRssMB: number
  cgroupCurrentMB: number | null
  cgroupPeakMB: number | null
  uptimeSec: number
}

// 項目を回す前後の差 (docs/127 §2)。GC の時機に左右されるので目安。判定には
// 周回の推移 (memoryRounds) を使う
export interface MemoryDelta {
  rssBeforeMB: number
  rssAfterMB: number
  heapUsedDeltaMB: number
  externalDeltaMB: number
  // この項目の間に最大 RSS が伸びた分 (伸びなければ 0)
  maxRssGrowthMB: number
}

// 周回ごとの記録。'開始' | '本計測後' | '周回 2' …
export interface MemoryRound {
  label: string
  memory: MemorySnapshot
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
  // ならしと計測の全回を通した前後の差。v0.23.138 以前の保存には無い
  memory?: MemoryDelta
}

export interface ServerBenchResult {
  version: 1
  env: BenchEnv
  items: ServerBenchItem[]
  // 失敗した項目 (除いて保存する。黙って欠けさせない)
  failed: { id: string; message: string }[]
  // 回路の解析のプロファイルを、元のモジュールごとの自己時間に畳んだ物 (多い順。
  // docs/122 §4)。古い保存 (v0.23.83) には無い
  profileModules?: { module: string; ms: number; pct: number }[]
  // 開始・本計測後・同じ処理をさらに回した後の推移 (docs/127 §2)。
  // 周回のたびに RSS が伸び続けるならリークを疑う。古い保存には無い
  memoryRounds?: MemoryRound[]
  // コンテナのメモリ上限 (cgroup の memory.max)。無制限・読めなければ null
  cgroupMaxMB?: number | null
  // 計測前のホストとコンテナの様子 (free -m・docker stats 相当)。古い保存には無い
  host?: HostSnapshot
}

// free -m と同じ列 (MiB、切り捨て)。used は procps-ng 4 と同じ total − available
export interface FreeMem {
  totalMB: number
  usedMB: number
  freeMB: number
  sharedMB: number
  buffCacheMB: number
  availableMB: number
  swapTotalMB: number
  swapUsedMB: number
  swapFreeMB: number
}

// docker stats --no-stream の 1 行に当たる値 (ホストの cgroup v2 から読む)
export interface ContainerStat {
  // 先頭 12 文字 (docker ps の CONTAINER ID)
  id: string
  // 名前の表に無ければ null (表が古い = 表を書いた後に作り直されたコンテナ)
  name: string | null
  // このアプリ自身のコンテナか (ホスト名 = 短い ID で見分ける)
  isSelf: boolean
  // 1 コア = 100% (docker stats と同じ尺度)。測れなければ null
  cpuPercent: number | null
  // memory.current − inactive_file (docker stats の MEM USAGE と同じ計算)
  memUsageMB: number
  // memory.max。無制限ならホストの総メモリ (docker stats の LIMIT と同じ)
  memLimitMB: number
  pids: number | null
}

export interface HostSnapshot {
  // ISO 8601
  takenAt: string
  freeMem: FreeMem | null
  // メモリの多い順
  containers: ContainerStat[]
  // 名前の表の更新日時 (ISO)。表が無ければ null
  namesAt: string | null
  // 読めなかった物の理由 (マウント漏れなど)。画面にそのまま出す
  notes: string[]
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
