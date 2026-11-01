// 回路図 SVG の検査を、同じ中身では 2 度しない控え (docs/123 §12-7)。
//
// 検査 (markdown/safeSvg.ts の assertSafeSvg) は XML の妥当性検査・解析・木の
// 組み直しを全文に通すので重い。同期の組み立ては 1 件でもノートが変われば
// 全部の図 (本番で 600 枚・6MB 強) を検査し直し、本番の CPU で 1.2 秒増えていた
// (v0.23.89 の正規表現の検査 → v0.23.90 の XML の検査)。配信 route も 1 枚
// 配るたびに検査する。
//
// **鍵は SVG の中身の SHA-256。** DB の主キー (版 + ソースの hash) では
// ない — DB の中身が書き換えられたら鍵も変わって検査し直すので、監査 M-3 の
// 「DB の中身も配る前に確かめる」は保たれる。覚えるのは**通った物だけ**
// (組み直した文字列)。通らない物は毎回検査して投げる。
//
// 合計の文字数に上限を置き、超えたら古く使った物から捨てる (Map の挿入順を
// 使った LRU)。本番の全図は 6MB 前後なので普段は全部が収まる
import 'server-only'
import { createHash } from 'node:crypto'

// 覚える合計 (検査済みの SVG の文字数)。全図の 2〜3 倍
export const SVG_CHECK_MEMO_LIMIT_CHARS = 16_000_000

export interface SafeSvgMemo {
  check: (svg: string) => string
  // いま覚えている枚数と文字数 (試験と計測用)
  size: () => { entries: number; chars: number }
  clear: () => void
}

export function createSafeSvgMemo(
  verify: (svg: string) => string,
  limitChars = SVG_CHECK_MEMO_LIMIT_CHARS,
): SafeSvgMemo {
  const checked = new Map<string, string>()
  let chars = 0

  const check = (svg: string): string => {
    const key = createHash('sha256').update(svg).digest('hex')
    const hit = checked.get(key)
    if (hit !== undefined) {
      // 使った物を後ろへ (捨てるのは先頭 = 長く使っていない物から)
      checked.delete(key)
      checked.set(key, hit)
      return hit
    }
    // 通らなければここで投げる (覚えない)
    const safe = verify(svg)
    if (safe.length > limitChars) {
      return safe
    }
    checked.set(key, safe)
    chars += safe.length
    for (const [oldKey, oldSvg] of checked) {
      if (chars <= limitChars) break
      checked.delete(oldKey)
      chars -= oldSvg.length
    }
    return safe
  }

  return {
    check,
    size: () => ({ entries: checked.size, chars }),
    clear: () => {
      checked.clear()
      chars = 0
    },
  }
}
