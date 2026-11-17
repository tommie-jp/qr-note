// 回線の計測 (docs/121-QR-Noteベンチマーク計画.md §4-1)。
//
// 同一オリジンの口 (api/diag/net) に対して、往復・下り・上りを測る。
// 計測テストの 1 段目で流し、`[計測] 回線 種別=Wi-Fi RTT=… 下り=… 上り=…` の
// 1 行にする。**ループで何十 MB も使う speedtest にはしない** — キャリアの
// 通信量を食う。下り 2MB・上り 1MB を 3 回ずつで止める。
//
// 手順だけを持ち、fetch と時計は引数で受ける (テストで差し替える)
import type { PerfField } from './perfLine'

export const NET_PATH = '/api/diag/net'
const RTT_RUNS = 5
const BULK_RUNS = 3
export const DOWNLOAD_BYTES = 2 * 1024 * 1024
export const UPLOAD_BYTES = 1024 * 1024

export interface NetProbeDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  now: () => number
  // 下りの受信時間 (responseStart → responseEnd) を Resource Timing から読む。
  // 読めなければ null (全体 − 往復で代える)
  receiveMs: (url: string) => number | null
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// bytes を ms で運んだときの Mbps
export function toMbps(bytes: number, ms: number): number {
  return (bytes * 8) / (Math.max(ms, 1) / 1000) / 1_000_000
}

export function formatMbps(mbps: number): string {
  return mbps >= 10 ? `${Math.round(mbps)}Mbps` : `${mbps.toFixed(1)}Mbps`
}

async function timed(deps: NetProbeDeps, url: string, init?: RequestInit): Promise<number> {
  const started = deps.now()
  const res = await deps.fetch(url, { cache: 'no-store', ...init })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  // 本文を読み切るまでが 1 回 (下りは受信そのもの)
  await res.arrayBuffer()
  return deps.now() - started
}

// 端末の回線を測り、行の項目を返す。送るのは呼ぶ側 (種別を先頭に足す)
export async function measureNet(deps: NetProbeDeps, uploadBody: Uint8Array<ArrayBuffer>): Promise<PerfField[]> {
  // 同じ URL を続けて撃つと Resource Timing の照合がずれるので、回ごとに印を付ける
  const url = (size: number, n: number) => `${NET_PATH}?size=${size}&n=${n}`

  const rtts: number[] = []
  for (let i = 0; i < RTT_RUNS; i += 1) {
    rtts.push(await timed(deps, url(0, i)))
  }
  const rtt = median(rtts)

  const downs: number[] = []
  for (let i = 0; i < BULK_RUNS; i += 1) {
    const target = url(DOWNLOAD_BYTES, i)
    const total = await timed(deps, target)
    downs.push(deps.receiveMs(target) ?? Math.max(total - rtt, 1))
  }

  const ups: number[] = []
  for (let i = 0; i < BULK_RUNS; i += 1) {
    const total = await timed(deps, `${NET_PATH}?n=${i}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: uploadBody,
    })
    ups.push(Math.max(total - rtt, 1))
  }

  return [
    ['RTT', `${Math.round(rtt)}ms`],
    ['下り', formatMbps(toMbps(DOWNLOAD_BYTES, median(downs)))],
    ['上り', formatMbps(toMbps(UPLOAD_BYTES, median(ups)))],
  ]
}
