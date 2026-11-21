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
// 削除の取り消し:
//   - 削除で書き換えた行の元の文と位置 (TagLineEdit) を控え、取り消しでは
//     その行を元の位置・元の書き方 (全角・空白) のまま差し戻す。
//   - 本文がその後に変わって位置が合わなければ、追加ルールで足し直す。

import { joinLines, newlineOf, splitLines } from '../memoLines'
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
  return removeTagsWithEdits(memo, [tag]).memo
}

// 複数タグをまとめて追加/削除する (1 つずつ畳み込む)。
export function addTagsToMemo(memo: string, tags: string[]): string {
  return tags.reduce(addTagToMemo, memo)
}

export function removeTagsFromMemo(memo: string, tags: string[]): string {
  return removeTagsWithEdits(memo, tags).memo
}

// 削除で書き換えたタグ行の控え。at は削除する前の本文での行番号 (0 始まり)、
// line はその行の元の文、removed は行ごと消えたか
export interface TagLineEdit {
  at: number
  line: string
  removed: boolean
}

// タグ行の中の tags を外した残り。外す物が無ければ null、全部外れたら []
function keptTokens(line: string, names: ReadonlySet<string>): string[] | null {
  const tokens = tagOnlyTokens(line)
  if (!tokens) {
    return null
  }
  const kept = tokens.filter((t) => !names.has(parseTagToken(t) ?? ''))
  return kept.length === tokens.length ? null : kept
}

// タグだけの行から tags を外し、書き換えた行を控える (取り消し用)。
// 空になった行は丸ごと消す
export function removeTagsWithEdits(
  memo: string,
  tags: readonly string[],
): { memo: string; edits: TagLineEdit[] } {
  const names = new Set(tags.map(normalizeTag))
  const out: string[] = []
  const edits: TagLineEdit[] = []
  splitLines(memo).forEach((line, at) => {
    const kept = keptTokens(line, names)
    if (kept === null) {
      out.push(line)
      return
    }
    edits.push({ at, line, removed: kept.length === 0 })
    if (kept.length > 0) {
      out.push(kept.join(' '))
    }
  })
  return { memo: edits.length === 0 ? memo : joinLines(out, memo), edits }
}

// 控えの行を元の位置に差し戻す。位置が合わない (本文が変わった) ときは null。
// 番号の小さい順に戻すので、戻すたびに手前の行番号は削除前のものに揃う
function replayEdits(memo: string, names: ReadonlySet<string>, edits: readonly TagLineEdit[]): string | null {
  // 全部の行が消えた本文 ('') は 0 行として扱う (空行 1 行ではない)
  const work = memo === '' ? [] : splitLines(memo)
  for (const { at, line, removed } of [...edits].sort((a, b) => a.at - b.at)) {
    const kept = keptTokens(line, names)
    // 控えが「tags を含むタグだけの行」でなければ受け付けない
    if (kept === null || removed !== (kept.length === 0) || at > work.length) {
      return null
    }
    if (removed) {
      work.splice(at, 0, line)
    } else if (work[at] === kept.join(' ')) {
      work[at] = line
    } else {
      return null
    }
  }
  return joinLines(work, memo)
}

// 一括削除の取り消し。外したタグを元の行・元の位置に戻す。戻せないとき
// (本文が変わった・既にどれかを付け直した) は addTagsToMemo で足りない分を足す
export function restoreRemovedTags(memo: string, tags: readonly string[], edits: readonly TagLineEdit[]): string {
  const names = new Set(tags.map(normalizeTag))
  const present = new Set(extractTags(memo))
  if (![...names].some((name) => present.has(name))) {
    const restored = replayEdits(memo, names, edits)
    if (restored !== null) {
      return restored
    }
  }
  return addTagsToMemo(memo, [...names])
}
