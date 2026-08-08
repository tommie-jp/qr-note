// 自動同期を撃つ間隔の判定 (docs/65-オフライン対応計画.md §3-2)。
//
// アプリを開くたびに全ノート (数百 KB) を落とし直すと、**QR シールを何枚も
// 読む使い方**でそれが枚数分になる (/item/:itemNo は毎回まるごとの画面読み込み)。
// 直前に同期していれば見送る。
//
// 手で撃つ口 (/offline の「今すぐ同期」) はこの判定を通さない — 利用者が
// 明示的に押したなら、間隔の都合で断るのはおかしい。
//
// 記録先は localStorage。IndexedDB の中 (同期した中身) と分けるのは、
// 「いつ試したか」は成功・失敗に関わらず残したいから — 失敗のたびに
// 全力で撃ち直すと、圏外で開くたびにタイムアウトを待つことになる。

export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000

export const LAST_SYNC_ATTEMPT_KEY = 'qr-search:offline-sync-attempt'

// 最後に暖機できたアプリの版。**版が変われば間隔を無視して暖機する** —
// 新しい版ではチャンク名が変わるので、古い殻は読み込めないチャンクを指した
// まま残る。間隔の都合で見送ると、その窓の間だけオフラインが死ぬ
export const LAST_WARM_VERSION_KEY = 'qr-search:offline-warmed-version'

// 前回の試行時刻 (localStorage の生の値) を見て、いま同期すべきかを返す。
//
// **読めない値と未来の値は「同期する」に倒す。** localStorage は手で編集
// できる外部入力で (memoDraft.ts と同じ扱い)、変な値を信じると同期が永久に
// 止まる — 圏外で開いて初めて気づく壊れ方になる。余分に 1 回撃つほうが安い。
export function shouldAutoSync(
  lastAttempt: string | null,
  now: number,
  intervalMs: number = AUTO_SYNC_INTERVAL_MS,
): boolean {
  if (lastAttempt === null) {
    return true
  }
  const at = Number(lastAttempt)
  if (!Number.isFinite(at) || lastAttempt.trim() === '') {
    return true
  }
  return at > now || now - at >= intervalMs
}

// --- localStorage への出入り口 ---
//
// **localStorage は触るだけで落ちうる。** Firefox の dom.storage.enabled=false
// では window.localStorage が undefined になり (例外は出ない)、Safari の
// ブロック時は getItem 側が SecurityError を投げる。素で触ると、その例外が
// 呼び出し元の効果を突き抜けて unhandled rejection になり、オフラインの
// 下ごしらえが**丸ごと黙って動かなくなる**。
//
// 読めない/書けないときは「記録が無い」と同じ扱いにする。同期が毎回走る
// だけで、機能は落ちない (schedule.ts 冒頭の「同期する側へ倒す」と同じ判断)。
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null)
  } catch {
    return null
  }
}

export function readMark(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeMark(key: string, value: string): void {
  try {
    storage()?.setItem(key, value)
  } catch {
    // 書けなくても困るのは「次も同期する」だけ
  }
}
