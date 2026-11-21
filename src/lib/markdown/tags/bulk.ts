// 一括タグ操作の UI / アクションで使う純関数 (DB 非依存)。
// タグの抽出・正規化は tags.ts に委ね、ここは「入力の解釈」と
// 「選択アイテムのタグ集計」だけを担う。

import { parseBackUrl, parseSelectedItemIds } from '../../items/itemSelection'
import type { TagLineEdit } from './edit'
import { extractTags, parseTagToken } from './tags'

// タグ入力の上限。itemId と同様、細工された巨大入力で 1 回の操作が
// item 数 × タグ数の重い処理にならないよう有界にする。
const MAX_INPUT_LENGTH = 1000
const MAX_TAGS = 50

// タグ入力欄 (空白区切り) を正規化済みタグ名の配列にする。
// `#` は付けても付けなくてもよい。タグにならないトークンは捨て、重複は初出順で除く。
export function parseTagInput(input: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const token of input.slice(0, MAX_INPUT_LENGTH).split(/\s+/)) {
    if (!token) {
      continue
    }
    const withHash = /^[#＃]/.test(token) ? token : `#${token}`
    const name = parseTagToken(withHash)
    // 正規化後の名前が再びタグとして読めるものだけ採用する。NFKC 展開で
    // タグに使えない文字になる入力 (⑴ → (1)、½ → 1⁄2 など) は書いても
    // extractTags が拾えず二重登録の元になるため弾く。
    if (name && parseTagToken(`#${name}`) === name && !seen.has(name)) {
      seen.add(name)
      tags.push(name)
      if (tags.length >= MAX_TAGS) {
        break
      }
    }
  }
  return tags
}

// 削除チップ用に、選択したアイテムが持つタグの和集合 (タグ名昇順・重複なし) を返す。
export function selectedTagsUnion(
  items: ReadonlyArray<{ itemId: string; tags: string[] }>,
  selected: Iterable<string>,
): string[] {
  const selectedSet = new Set(selected)
  const union = new Set<string>()
  for (const item of items) {
    if (selectedSet.has(item.itemId)) {
      for (const tag of item.tags) {
        union.add(tag)
      }
    }
  }
  return [...union].sort()
}

export interface BulkTagRequest {
  mode: 'add' | 'remove'
  itemIds: string[] // 検証済み・重複除去済み
  tags: string[] // 正規化済み
  back: string // 操作後に戻る一覧 URL
}

// 一括操作フォームの内容を解釈する (DB 非依存なので単体テストできる)。
// 押されたボタンで add / remove を判別する:
//   - 削除チップ (name="removeTag") が来ていれば remove、その値が対象タグ。
//   - それ以外は add で、addTags 入力欄 (空白区切り) を対象タグにする。
export function parseBulkTagForm(formData: FormData): BulkTagRequest {
  const removeTag = formData.get('removeTag')
  const isRemove = typeof removeTag === 'string' && removeTag.length > 0
  const rawTags = isRemove ? removeTag : String(formData.get('addTags') ?? '')

  return {
    mode: isRemove ? 'remove' : 'add',
    itemIds: parseSelectedItemIds(formData),
    tags: parseTagInput(rawTags),
    back: parseBackUrl(formData),
  }
}

// 一括タグで 1 件のノートに実際に起きた変化 (「元に戻す」に使う)
export interface TagChange {
  itemId: string
  tags: string[] // 正規化済み。このノートで実際に増えた (外れた) タグだけ
  // 削除のときだけ。書き換えたタグ行の元の文と位置 (元の位置に差し戻す材料)
  lines?: TagLineEdit[]
}

// 1 回の一括タグの結果。取り消しは mode の逆をする
export interface TagChangeSet {
  mode: 'add' | 'remove'
  changes: TagChange[]
}

// 控えの上限。取り消しの要求は端末から来るので、ここで有界にする
const MAX_EDITS = 200
const MAX_LINE_LENGTH = 2000

// 書き換えの前後の本文から、指定したタグのうち実際に増えた (mode=remove なら
// 外れた) ものを返す。**元から持っていたタグは入れない** — 取り消しでそれを
// 外すと、追加する前から付いていたタグまで消えてしまう
export function changedTagsOf(
  mode: 'add' | 'remove',
  before: string,
  after: string,
  tags: readonly string[],
): string[] {
  const had = new Set(extractTags(before))
  const has = new Set(extractTags(after))
  return tags.filter((tag) => (mode === 'add' ? !had.has(tag) && has.has(tag) : had.has(tag) && !has.has(tag)))
}

// 取り消しの送り方。同じタグの組を持つノートを 1 回の「外す」にまとめる。
// 大半は全件が同じ組 (= 1 回で済む)。組の並びは初出順
export function groupTagChanges(
  changes: readonly TagChange[],
): { tags: string[]; itemIds: string[] }[] {
  const groups = new Map<string, { tags: string[]; itemIds: string[] }>()
  for (const { itemId, tags } of changes) {
    if (tags.length === 0) {
      continue
    }
    const key = tags.join(' ')
    const group = groups.get(key)
    if (group) {
      group.itemIds.push(itemId)
    } else {
      groups.set(key, { tags: [...tags], itemIds: [itemId] })
    }
  }
  return [...groups.values()]
}

// API の応答 (data.changes) を TagChange[] に読む。形の違う項目は捨てる
// (取り消せる分が減るだけで、追加そのものは済んでいる)
export function parseTagChanges(data: unknown): TagChange[] {
  const changes = (data as { changes?: unknown } | null)?.changes
  if (!Array.isArray(changes)) {
    return []
  }
  return changes.flatMap((change: unknown) => {
    const { itemId, tags, lines } = (change ?? {}) as { itemId?: unknown; tags?: unknown; lines?: unknown }
    if (typeof itemId !== 'string' || !Array.isArray(tags)) {
      return []
    }
    const names = tags.filter((tag): tag is string => typeof tag === 'string').slice(0, MAX_TAGS)
    if (names.length === 0) {
      return []
    }
    return [Array.isArray(lines) ? { itemId, tags: names, lines: parseLineEdits(lines) } : { itemId, tags: names }]
  })
}

function parseLineEdits(lines: unknown[]): TagLineEdit[] {
  return lines
    .flatMap((edit: unknown) => {
      const { at, line, removed } = (edit ?? {}) as { at?: unknown; line?: unknown; removed?: unknown }
      const isValid =
        Number.isInteger(at) &&
        (at as number) >= 0 &&
        typeof line === 'string' &&
        line.length <= MAX_LINE_LENGTH &&
        typeof removed === 'boolean'
      return isValid ? [{ at: at as number, line: line as string, removed: removed as boolean }] : []
    })
    .slice(0, MAX_EDITS)
}

// 取り消しの帯の文。「3 件に #a #b を追加しました」「3 件から #a を外しました」
export function tagUndoMessage({ mode, changes }: TagChangeSet): string {
  const tags = [...new Set(changes.flatMap((change) => change.tags))].map((tag) => `#${tag}`).join(' ')
  return mode === 'add'
    ? `${changes.length} 件に ${tags} を追加しました`
    : `${changes.length} 件から ${tags} を外しました`
}
