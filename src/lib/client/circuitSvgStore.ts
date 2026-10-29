// 回路図の SVG の控え (docs/124 §1)。画像表示のタイルが、図の中の文字を
// ページの字体 (/tikzjax/fonts.css) で描くために SVG を埋め込むときに使う。
// 行のサムネは <img> で URL を直に引くので、ここを通らない。
//
// 口 (/api/circuits/svg/<hash>) は immutable なので、ブラウザのキャッシュに
// 当たれば往復しない。ここはそれを JS の文字列として持つだけ
import 'client-only'
import { circuitSvgUrl } from '@/lib/circuit/svgUrl'
import { createResourceCache } from './resourceCache'

// 画像表示 1 画面ぶん (20 件 × 数枚) と、その前後を覚える
const MAX_SVGS = 300
// 中身は変わらないので、期限で取り直さない
const NEVER = Number.POSITIVE_INFINITY

export const circuitSvgCache = createResourceCache<string, string>({
  maxEntries: MAX_SVGS,
  maxAgeMs: NEVER,
  async fetch(hash) {
    const response = await fetch(circuitSvgUrl(hash), { credentials: 'same-origin' })
    if (!response.ok) {
      throw new Error(`回路図を読み込めませんでした (${response.status})`)
    }
    const text = await response.text()
    if (!text.trimStart().startsWith('<svg')) {
      throw new Error('回路図の形が違います')
    }
    return text
  },
})
