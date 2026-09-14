// 診断イベントのログ (docs/30-ブラウザログ計画.md §6)。
//
// メモリ不足の調査で「いつ・何が生きていたか」を実機の /logs から読むための
// 口。エラーではないので console は包まず、info として直接サーバへ送る。
//
// **メモリの数値は iPhone では取れない**。iOS は全ブラウザが WebKit で、
// performance.memory (Blink 独自)・navigator.deviceMemory・
// measureUserAgentSpecificMemory のどれも無く、残量は OS が隠している
// (jetsam は予告なく殺す)。取れる環境 (PC Chrome) でだけ JS ヒープを添える。
// iPhone ではイベントの**順序と経過時間**が診断の本体になる。
//
// 「大きな ArrayBuffer を試しに確保して残量を推定する」プローブはやらない —
// その確保自体が jetsam の引き金になり、調べたいものを調べる前に殺される。
//
// ブラウザ / Worker のどちらからも呼べる (sendClientLogs は Worker では
// Beacon が無く fetch に落ちるが、経路はそれで足りる)。

import { sendClientLogs } from './clientTransport'

export interface MemorySnapshot {
  // いま生きているオブジェクトの量
  usedMB: number
  // V8 が確保済みのヒープ総量 (used より大きい)
  totalMB: number
  // これ以上育てられない上限。**環境の指紋になる**: 通常の x64 Chrome は
  // ~4GB、~1120MB なら 32bit Chrome か低メモリ端末 (実測で 32bit を特定した)
  limitMB: number
}

// Blink 系だけが持つ非標準 API の形。外から来る形は信じず数値を確かめる
interface PerformanceWithMemory {
  memory?: {
    usedJSHeapSize?: unknown
    totalJSHeapSize?: unknown
    jsHeapSizeLimit?: unknown
  }
}

const BYTES_PER_MB = 1024 * 1024

// performance.memory が読めれば JS ヒープの使用/確保済み/上限 (MB)。
// 無ければ null。引数はテストのため (既定は globalThis.performance)。
export function readMemorySnapshot(
  perf: unknown = typeof performance !== 'undefined' ? performance : undefined,
): MemorySnapshot | null {
  const memory = (perf as PerformanceWithMemory | undefined)?.memory
  if (!memory) {
    return null
  }
  const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = memory
  if (
    typeof usedJSHeapSize !== 'number' ||
    typeof totalJSHeapSize !== 'number' ||
    typeof jsHeapSizeLimit !== 'number'
  ) {
    return null
  }
  return {
    usedMB: Math.round(usedJSHeapSize / BYTES_PER_MB),
    totalMB: Math.round(totalJSHeapSize / BYTES_PER_MB),
    limitMB: Math.round(jsHeapSizeLimit / BYTES_PER_MB),
  }
}

// イベント文 + (取れれば) ヒープの要約。
export function formatDiagEvent(
  text: string,
  snapshot: MemorySnapshot | null,
): string {
  if (!snapshot) {
    return text
  }
  return `${text} [JSヒープ 使用${snapshot.usedMB} 確保${snapshot.totalMB} 上限${snapshot.limitMB}MB]`
}

// ブラウザのビット数などの環境情報。null は「取れない」(不明) の意。
export interface EnvInfo {
  // '32' | '64'。**ブラウザ本体の**ビット数 (OS ではない)。32bit Chrome は
  // アドレス空間 ~2GB で wasm の大きな連続確保が破綻する (実測で特定した原因)
  bitness: string | null
  architecture: string | null
  // 64bit OS 上で 32bit ブラウザが動いているか。true なら
  // 「64bit 版に入れ替えれば直る」と言い切れる
  wow64: boolean | null
  // 端末の物理メモリの目安 (GB)。8 は「8 以上」(仕様で頭打ち)
  deviceMemoryGB: number | null
  cores: number | null
}

// User-Agent Client Hints から環境情報を読む。Chromium 系限定
// (WebKit/Firefox は userAgentData が無く、ビット数は取れない)。
// 引数はテストのため (既定は globalThis.navigator)。
export async function readEnvInfo(
  nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined,
): Promise<EnvInfo> {
  const n = nav as
    | {
        userAgentData?: {
          getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>
        }
        deviceMemory?: unknown
        hardwareConcurrency?: unknown
      }
    | undefined

  let bitness: string | null = null
  let architecture: string | null = null
  let wow64: boolean | null = null
  const getHints = n?.userAgentData?.getHighEntropyValues?.bind(n.userAgentData)
  if (getHints) {
    try {
      const hints = await getHints(['architecture', 'bitness', 'wow64'])
      if (typeof hints.bitness === 'string' && hints.bitness !== '') {
        bitness = hints.bitness
      }
      if (typeof hints.architecture === 'string' && hints.architecture !== '') {
        architecture = hints.architecture
      }
      if (typeof hints.wow64 === 'boolean') {
        wow64 = hints.wow64
      }
    } catch {
      // 拒否・非対応は「不明」のまま。当てずっぽうを出すより正直に
    }
  }
  return {
    bitness,
    architecture,
    wow64,
    deviceMemoryGB: typeof n?.deviceMemory === 'number' ? n.deviceMemory : null,
    cores: typeof n?.hardwareConcurrency === 'number' ? n.hardwareConcurrency : null,
  }
}

// 環境情報を 1 行にする。
export function formatEnvSummary(info: EnvInfo): string {
  const bit = info.bitness
    ? `${info.bitness}bit${info.architecture ? ` ${info.architecture}` : ''}${
        info.wow64 ? ' (WOW64)' : ''
      }`
    : 'ビット数不明 (userAgentData 非対応)'
  const parts = [`ブラウザ ${bit}`]
  if (info.deviceMemoryGB !== null) {
    parts.push(`RAM ~${info.deviceMemoryGB}GB`)
  }
  if (info.cores !== null) {
    parts.push(`CPUコア ${info.cores}`)
  }
  return `[環境] ${parts.join(' / ')}`
}

// 環境情報を 1 度だけ /logs へ送る。重いモデルを積み始める瞬間
// (OCR / 画像検索の Worker 起動) に呼ぶ — そこが「この端末で動くか」を
// 環境が決める場面で、毎ページ送ると 200 件のバッファを埋めるだけになる
let envLogged = false
export function logEnvironmentOnce(): void {
  if (envLogged) {
    return
  }
  envLogged = true
  void readEnvInfo().then((info) => {
    sendClientLogs([
      {
        level: 'info',
        text: formatDiagEvent(formatEnvSummary(info), readMemorySnapshot()),
      },
    ])
  })
}

// 診断イベントを 1 件送る。/logs に info バッジで並ぶ。
// 失敗ではないものに warn/error を使わない (本物の警告を info で薄めない)。
export function logDiagEvent(text: string): void {
  sendClientLogs([
    { level: 'info', text: formatDiagEvent(text, readMemorySnapshot()) },
  ])
}
