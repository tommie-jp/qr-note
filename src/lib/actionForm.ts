// サーバーアクション (src/app/actions/) がフォームを読む純関数と、競合の知らせの形。
//
// Server Action は誰でも叩ける POST の口なので、フォームの値は型も長さも自分で
// 確かめる。ここは DB も Next も知らない (テスト容易性)。**'use server' の
// ファイルには置かない** — そこで export した関数はすべて外から呼べる口になる

import type { Item } from '@/generated/prisma/client'
import { parseBase, type SaveBase } from '@/lib/saveBase'
import { noteSnapshot, type SaveState } from '@/lib/saveState'
import { isValidItemNo, MAX_TEXT_LENGTH } from '@/lib/validation'

export function readText(formData: FormData, key: string): string {
  const value = formData.get(key)
  if (typeof value !== 'string') {
    return ''
  }
  if (value.length > MAX_TEXT_LENGTH) {
    throw new Error(`${key} が長すぎます (最大 ${MAX_TEXT_LENGTH} 文字)`)
  }
  return value
}

export function readItemNo(formData: FormData): string {
  const itemNo = String(formData.get('itemNo') ?? '')
  if (!isValidItemNo(itemNo)) {
    throw new Error('itemNo が不正です')
  }
  return itemNo
}

// 画面が見ていた版 (docs/87-編集競合対策計画.md §2-1)。
// **不正なら投げる** — 基点が読めない保存を「新規」や「いまの版」に丸めると、
// この仕組みが守ろうとしている上書きをそのまま許すことになる
export function readBase(formData: FormData): SaveBase {
  const base = parseBase(formData.get('base'))
  if (base === null) {
    throw new Error('保存の基点が不正です')
  }
  return base
}

// 競合の知らせ。成功はリダイレクトして終わるので、戻り値が要るのはここだけ
export function conflictState(
  kind: 'conflict' | 'exists' | 'missing' | 'checkpointFailed',
  current: Item | null,
): SaveState {
  return {
    // 同じ結果に 2 度反応しないための印 (?saved= と同じ流儀)
    seq: Date.now(),
    kind,
    server: current === null ? null : noteSnapshot(current),
  }
}
