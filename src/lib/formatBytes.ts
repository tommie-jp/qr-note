// バイト数・割合・時間の整形。サーバー情報 (docs/109) とオフライン保存量
// (components/offline, components/item) が共有する。
// 1KB = 1024 で数える — 端末の保存容量・DB の大きさの話で、回線の 1000 進法ではない

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const BYTES_PER_UNIT = 1024

// 1024 刻みで単位を上げ、小数 1 桁。bigint も受けるのは pg_database_size などの
// PostgreSQL の bigint が Prisma の $queryRaw で bigint として返るため
export function formatBytes(bytes: number | bigint): string {
  let value = Number(bytes)
  let unit = 0
  while (value >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT
    unit += 1
  }
  return unit === 0 ? `${value} ${BYTE_UNITS[0]}` : `${value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

// 整数の百分率。分母 0 (スワップ無し・読めない) は割らずに「-」
export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) {
    return '-'
  }
  return `${Math.round((part / whole) * 100)}%`
}

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 86400

// 稼働時間 (秒) を 日 / 時間 / 分 に畳む。秒は出さない — 「3 日 2 時間」が
// 分かれば足りる場面にしか使わない
export function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / SECONDS_PER_DAY)
  const hours = Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR)
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  if (days > 0) {
    return `${days} 日 ${hours} 時間 ${minutes} 分`
  }
  if (hours > 0) {
    return `${hours} 時間 ${minutes} 分`
  }
  return `${minutes} 分`
}
