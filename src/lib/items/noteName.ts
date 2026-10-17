import type { Mode } from '@/lib/validation'

// 読み上げ名・確認文で「どのノートか」を名乗るときの呼び名 (docs/107 §4-4)。
//
// もとは `#1003` (旧番号) で名乗っていたが、id (UUID) は人が読む物ではない。
// 一覧に出ている見出しと同じ物 (URL モードは url) を鉤括弧で包む。長い見出しは
// 読み上げが行ごとに延々と続くので切る。見出しの無いノート (画像だけ) は
// 「無題のノート」と呼ぶ — 同じ名前が並びうるが、行の中の他の操作と同じく
// 読み上げは行の位置で区別される
const MAX_NAME_LENGTH = 40

export function noteName(item: { mode: Mode; url: string; title: string }): string {
  const raw = (item.mode === 'url' ? item.url : item.title).trim()
  if (raw === '') {
    return '無題のノート'
  }
  const short = raw.length > MAX_NAME_LENGTH ? `${raw.slice(0, MAX_NAME_LENGTH)}…` : raw
  return `「${short}」`
}
