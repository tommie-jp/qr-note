// ブラウザが送ってくる CSP 違反の報告を 1 行の文字列に畳む (2026-11 の監査 M-1)。
//
// 形式は 2 つある:
//   report-uri  … { "csp-report": { "document-uri", "violated-directive",
//                   "blocked-uri", "source-file", "line-number", … } }
//   report-to   … [ { "type": "csp-violation", "body": { "documentURL",
//                   "effectiveDirective", "blockedURL", "sourceFile",
//                   "lineNumber", … } }, … ]
// 読むのは /logs の人なので、どちらも「どの頁で・どの指令に・何が」の 1 行にする。
// 入力は信用しない (未ログインの誰でも POST できる口)。長さを切り、件数も絞る。

export const MAX_REPORT_BYTES = 16 * 1024
// 1 回の POST から拾う最大件数 (report-to は束で届く)
const MAX_REPORTS_PER_POST = 5
const FIELD_LIMIT = 200

type Dict = Readonly<Record<string, unknown>>

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function field(source: Dict, ...keys: readonly string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value !== '') {
      return value.length > FIELD_LIMIT ? `${value.slice(0, FIELD_LIMIT)}…` : value
    }
    if (typeof value === 'number') {
      return String(value)
    }
  }
  return '-'
}

function summarize(body: Dict): string {
  const page = field(body, 'document-uri', 'documentURL')
  const directive = field(body, 'effective-directive', 'effectiveDirective', 'violated-directive')
  const blocked = field(body, 'blocked-uri', 'blockedURL')
  const source = field(body, 'source-file', 'sourceFile')
  const line = field(body, 'line-number', 'lineNumber')
  return `${directive} が ${blocked} を止めた (頁 ${page}, 出所 ${source}:${line})`
}

// 解釈できなければ空。例外は投げない (壊れた JSON は黙って捨てる)
export function summarizeCspReports(text: string): readonly string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (Array.isArray(parsed)) {
    return parsed
      .filter(isDict)
      .filter((report) => report.type === 'csp-violation' && isDict(report.body))
      .slice(0, MAX_REPORTS_PER_POST)
      .map((report) => summarize(report.body as Dict))
  }
  if (isDict(parsed) && isDict(parsed['csp-report'])) {
    return [summarize(parsed['csp-report'])]
  }
  return []
}
