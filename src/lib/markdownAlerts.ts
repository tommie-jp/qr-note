// アラート記法 (`> [!NOTE]`) の語彙の単一ソース
// (docs/54-markdown表示拡張計画.md §2)。
//
// 表示側 (components/remarkAlerts.ts) と一覧の要約 (memoSummary.ts) の両方が
// 「どれが目印か」を知る必要があるため、どちらにも依存しない葉モジュールに
// 置く (fenceLanguages.ts と同じ作法)。remarkAlerts を直接読ませると
// unist-util-visit と mdast が一覧の描画経路にまで付いてくる。
//
// 分けておかないと、片方だけが知らない種類まで剥がして「詳細画面には
// [!FOO] と出るのに一覧の要約からは消える」といった食い違いが起きる。

export const ALERT_TYPES = [
  'note',
  'tip',
  'important',
  'warning',
  'caution',
] as const

export type AlertType = (typeof ALERT_TYPES)[number]

// 段落の**先頭**の目印。続く改行も一緒に食べる — remarkBreaks より後ろで
// 動くときは break ノードとして、前で動くときは "\n" のまま残っている
const MARKER = /^\[!([A-Za-z]+)\][^\S\r\n]*(?:\r?\n)?/

// 先頭の目印を読んで、種類と**目印を除いた残り**を返す。
// 知らない種類 (`[!FOO]`) は目印として扱わない (null) — 本文の一部として
// そのまま見せる
export function readAlertMarker(
  value: string,
): { type: AlertType; rest: string } | null {
  const match = MARKER.exec(value)
  if (match === null) {
    return null
  }
  const name = match[1].toLowerCase()
  const type = ALERT_TYPES.find((candidate) => candidate === name)
  return type === undefined ? null : { type, rest: value.slice(match[0].length) }
}
