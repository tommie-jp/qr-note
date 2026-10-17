// /proc/meminfo の読み方 (docs/109-サーバー情報計画.md §3)。
//
// コンテナの中でもカーネルは共有なので、ここに出るのは**ホストの**値
// (cgroup の上限は別のファイル。hostInfo.ts)。vps2 は 2GB で既にスワップ中
// なので、残りの見張りはこの 4 行で足りる。
//
// os.freemem() を使わないのは、あれが MemFree (キャッシュを含まない) で
// 「空きが無い」ように見えるため。使えるのは MemAvailable のほう。
//
// 単位は常に kB (カーネルの表記)。バイトにして返す

export interface MemInfo {
  totalBytes: number
  availableBytes: number
  // スワップ無しの環境は 0 / 0
  swapTotalBytes: number
  swapFreeBytes: number
}

const KB = 1024

// `MemTotal:        2010000 kB` の行から kB の数値を取る
function readKb(text: string, key: string): number | null {
  const match = new RegExp(`^${key}:\\s+(\\d+)\\s*kB\\s*$`, 'm').exec(text)
  return match ? Number(match[1]) : null
}

// MemTotal と MemAvailable が揃わなければ null — 片方だけで割合を出すと
// 嘘の判定になるので「読めなかった」に倒す
export function parseMeminfo(text: string): MemInfo | null {
  const total = readKb(text, 'MemTotal')
  const available = readKb(text, 'MemAvailable')
  if (total === null || available === null) {
    return null
  }
  return {
    totalBytes: total * KB,
    availableBytes: available * KB,
    swapTotalBytes: (readKb(text, 'SwapTotal') ?? 0) * KB,
    swapFreeBytes: (readKb(text, 'SwapFree') ?? 0) * KB,
  }
}
