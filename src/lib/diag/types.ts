// サーバー情報の形 (docs/109-サーバー情報計画.md)。
//
// 収集 (hostInfo / appInfo / dbInfo) と表示 (settings/server/page.tsx) と
// コピー用の整形 (formatServerInfo) が共有する。状態も I/O も持たない。

export interface InfoRow {
  label: string
  value: string
}

// 節ごとに成否を持つ。1 節が取れなくても他の節は出す (docs/109 §2) ので、
// 失敗は例外ではなく値として運ぶ
export type SectionResult =
  | { kind: 'ok'; rows: InfoRow[] }
  | { kind: 'failed'; message: string }

export interface InfoSection {
  id: string
  title: string
  result: SectionResult
}

// ok < warn < error の順に悪い。全体の判定は最悪の行に揃える
export type HealthLevel = 'ok' | 'warn' | 'error'

export interface HealthCheck {
  name: string
  level: HealthLevel
  // 一言の根拠 (「12ms」「使用 60%」)。判定だけ出すと次に何を見るか分からない
  detail: string
}

export interface ServerInfo {
  collectedAt: Date
  overall: HealthLevel
  checks: HealthCheck[]
  sections: InfoSection[]
}
