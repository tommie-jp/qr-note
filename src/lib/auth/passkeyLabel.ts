// パスキーに付ける名前の正規化 (docs/29-パスキー計画.md §8)。
//
// 名前は一覧で端末を見分けるためだけのもので、認証には一切使わない。
// それでも外から来る値なので、境界でそろえてから DB へ入れる。
//
// **断らずに直す**方針にしてある。ここで 400 を返すと、Face ID まで済ませた
// 登録が名前の書き方だけで失われる (認証器の側はもう鍵を作っている)。
// 名前は後から付け直せるものなので、通してしまうほうが損が小さい。

export const PASSKEY_LABEL_FALLBACK = 'パスキー'

// 一覧の 1 行に収まる長さ。超えたぶんは切る (断らない)
export const PASSKEY_LABEL_MAX = 40

// 制御文字 (改行・タブを含む) と DEL。一覧の表示が崩れるので空白に落とす
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g

export function normalizePasskeyLabel(raw: unknown): string {
  if (typeof raw !== 'string') {
    return PASSKEY_LABEL_FALLBACK
  }

  const cleaned = raw
    .replace(CONTROL_CHARS, ' ')
    // 制御文字を落とした跡が連続した空白になるので畳む
    .replace(/\s+/g, ' ')
    .trim()

  if (cleaned === '') {
    return PASSKEY_LABEL_FALLBACK
  }

  return cleaned.slice(0, PASSKEY_LABEL_MAX)
}
