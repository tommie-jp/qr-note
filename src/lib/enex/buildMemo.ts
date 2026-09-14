// ENEX の 1 ノートを、このアプリの memo 本文 1 枚に組み立てる (DB 非依存の純関数)。
//
// このアプリに題名の列は無く、一覧の要約は memo の 1 行目から作られる
// (markdown/memoSummary.ts)。そのため題名は**本文の 1 行目**として書く
// (docs/28-エクスポート計画.md §4 の対応表)。

import { normalizeTag, parseTagToken } from '@/lib/markdown/tags/tags'

// タグ名に使えない文字。markdown/tags/tags.ts の TAG_INNER (`[\p{L}\p{N}\p{M}_-]`) の裏返し
const NOT_TAG_CHAR = /[^\p{L}\p{N}\p{M}_-]+/gu

// Evernote のタグをこのアプリの `#タグ` に使える名前へ寄せる。
// 寄せようがないものは null (呼び出し側がレポートに載せる)。
//
// Evernote のタグは空白も記号も含められるが、このアプリのタグは本文中の
// `#タグ` が正本なので、区切りに使えない文字は書けない。落とすのではなく
// `-` に寄せるのは、「電子 工作」を「電子工作」に潰すと別のタグと衝突しうるため。
export function enexTagToMemoTag(raw: string): string | null {
  const name = normalizeTag(raw)
    .replace(NOT_TAG_CHAR, '-')
    // 寄せた結果の連続する - を 1 つに畳み、前後の - を落とす
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')

  // 正規化後の名前が再びタグとして読めるものだけ採用する (markdown/tags/bulk.ts と同じ
  // 考え方)。読めないものを書いても extractTags が拾わず、タグ検索に出てこない
  return parseTagToken(`#${name}`) === name ? name : null
}

// 題名・タグ行・本文をこの順に空行で継ぐ。
//
// **タグ行を本文より前に置く**のが要点。本文がコードフェンスで始まる/終わる
// ノートだと、後ろに置いたタグ行がフェンスの内側に落ちて extractTags に
// 拾われなくなる (markdown/tags/tags.ts の stripCode がコード内を対象外にするため)。
export function buildMemo(
  title: string,
  body: string,
  tags: readonly string[],
): string {
  const tagLine = tags.map((tag) => `#${tag}`).join(' ')
  return [title.trim(), tagLine, body.trim()]
    .filter((block) => block !== '')
    .join('\n\n')
}
