// 複数ノートへの一括タグ付け/削除で使う、メモ本文のテキスト変換 (DB 非依存の純関数)。
// タグの正本はメモ本文なので (tags.ts 参照)、一括操作もここで本文を書き換え、
// 保存は upsertMemo に任せて items.tags を再計算させる。
//
// 追加ルール:
//   - 本文のどこかに既にそのタグがあれば何もしない (extractTags で判定)。
//   - 2 行目に既にタグがあれば、その行末に " #tag" を追記する。
//   - そうでなければ 2 行目として "#tag" 行を挿入する (既存の 2 行目以降は下へ)。
//     空メモは "#tag" 単独にする (先頭に空行を作らない)。
// 削除ルール:
//   - 「タグだけの行」(空白区切りの全トークンがタグ) から該当タグを取り除く。
//     行が空になればその行ごと消す。
//   - 文章中に混ざったタグ (例: "RITEX #1612 隣家前") は壊さないため対象外。

import { joinLines, newlineOf, splitLines } from './memoLines'
import { extractTags, normalizeTag, parseTagToken } from './tags'

// 行が「タグだけの行」なら空白区切りのトークン列を、そうでなければ null を返す。
function tagOnlyTokens(line: string): string[] | null {
  const tokens = line.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return null
  }
  return tokens.every((t) => parseTagToken(t) !== null) ? tokens : null
}

// メモにタグを 1 つ追加する (tag は生入力でよい: 正規化して書き込む)。
// 書き込み側 (配置) と読み取り側 (extractTags) の解釈を一致させる:
//   - 既に本文のどこかにあれば何もしない (extractTags 基準)。
//   - 2 行目が「タグだけの行」なら行末に追記、そうでなければ 2 行目に挿入。
//   - 挿入結果でタグが拾えない (コードフェンス内に落ちた等) 場合は、
//     末尾に安全なタグ行を足して必ず索引されるようにする。
export function addTagToMemo(memo: string, tag: string): string {
  const name = normalizeTag(tag)
  if (extractTags(memo).includes(name)) {
    return memo
  }
  if (memo.trim() === '') {
    return `#${name}`
  }
  const nl = newlineOf(memo)
  const lines = splitLines(memo)
  const second = lines[1]
  if (second !== undefined && tagOnlyTokens(second) !== null) {
    lines[1] = `${second} #${name}`
  } else {
    lines.splice(1, 0, `#${name}`)
  }
  const candidate = joinLines(lines, memo)
  if (extractTags(candidate).includes(name)) {
    return candidate
  }
  return `${memo}${memo.endsWith('\n') ? '' : nl}#${name}`
}

// メモからタグを 1 つ削除する (タグだけの行から)。改行コードは保つ。
export function removeTagFromMemo(memo: string, tag: string): string {
  const name = normalizeTag(tag)
  const out: string[] = []
  for (const line of splitLines(memo)) {
    const tokens = tagOnlyTokens(line)
    if (!tokens) {
      out.push(line)
      continue
    }
    const kept = tokens.filter((t) => parseTagToken(t) !== name)
    if (kept.length === tokens.length) {
      out.push(line)
    } else if (kept.length > 0) {
      out.push(kept.join(' '))
    }
    // kept が空になった行は丸ごと削除 (push しない)
  }
  return joinLines(out, memo)
}

// 複数タグをまとめて追加/削除する (1 つずつ畳み込む)。
export function addTagsToMemo(memo: string, tags: string[]): string {
  return tags.reduce(addTagToMemo, memo)
}

export function removeTagsFromMemo(memo: string, tags: string[]): string {
  return tags.reduce(removeTagFromMemo, memo)
}
