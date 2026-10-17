// /etc/os-release の読み方 (docs/109-サーバー情報計画.md §3)。
//
// 形は `KEY=VALUE` の行の並びで、VALUE は二重引用符で括られることがある
// (freedesktop の os-release(5))。シェルの構文を全部は受けない — 実際の
// ディストリが書くのは引用符ありなしの 2 通りだけで、それ以上を解釈すると
// 読めたふりをして変な値を出す側に倒れる。
//
// 純粋関数。ファイルを読むのは hostInfo.ts (コンテナ自身の /etc/os-release と、
// compose がマウントしたホストの /host/os-release の 2 つを同じ関数で読む)

export function parseOsRelease(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) {
      continue
    }
    const key = line.slice(0, eq)
    const value = line.slice(eq + 1)
    fields[key] = unquote(value)
  }
  return fields
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  return value
}

// 人が読む 1 行の名前。PRETTY_NAME が無いディストリ (alpine の一部) は
// NAME と VERSION_ID をつなぎ、それも無ければ ID。何も無ければ null
// (「不明」を呼ぶ側が決める — ここで文字を作ると表示とコピーで二重になる)
export function osPrettyName(text: string): string | null {
  const fields = parseOsRelease(text)
  if (fields.PRETTY_NAME) {
    return fields.PRETTY_NAME
  }
  if (fields.NAME) {
    return fields.VERSION_ID ? `${fields.NAME} ${fields.VERSION_ID}` : fields.NAME
  }
  return fields.ID ?? null
}
