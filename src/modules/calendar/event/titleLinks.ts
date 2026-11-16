// 予定の題名の中の URL を切り出す (docs/126 §1-37)。DB にも React にも触らない純関数。
//
// 拾うのは http(s) だけ。URL に使える ASCII の文字が続く間を URL と見るので、
// 「資料https://example.com/docを見る」のように日本語に挟まれても日本語の所で切れる。
// 末尾の句読点と、対になっていない閉じ括弧は URL に含めない (文の区切りのことが多い)
export type TitlePart = { kind: 'text'; text: string } | { kind: 'url'; text: string }

const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/

// 末尾の句読点・対の無い ) を落とす
function trimUrl(candidate: string): string {
  let url = candidate.replace(TRAILING_PUNCTUATION, '')
  while (url.endsWith(')') && count(url, '(') < count(url, ')')) {
    url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, '')
  }
  return url
}

function count(text: string, char: string): number {
  return text.split(char).length - 1
}

// 開ける URL か (ホストの無い `https://` を弾く)
function isOpenableUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== ''
  } catch {
    return false
  }
}

export function splitTitleLinks(title: string): TitlePart[] {
  const parts: TitlePart[] = []
  const pushText = (text: string) => {
    if (text !== '') {
      parts.push({ kind: 'text', text })
    }
  }
  let rest = 0
  for (const match of title.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0])
    if (!isOpenableUrl(url)) {
      continue
    }
    pushText(title.slice(rest, match.index))
    parts.push({ kind: 'url', text: url })
    rest = match.index + url.length
  }
  pushText(title.slice(rest))
  // 隣り合う文字の部分 (弾いた URL の前後) を 1 つにまとめる
  return parts.reduce<TitlePart[]>((merged, part) => {
    const last = merged.at(-1)
    return last?.kind === 'text' && part.kind === 'text'
      ? [...merged.slice(0, -1), { kind: 'text', text: last.text + part.text }]
      : [...merged, part]
  }, [])
}
