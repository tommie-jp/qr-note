// サーバー情報のコピー用テキスト (docs/109-サーバー情報計画.md §2)。
// 画面と同じ並び (判定 → 節) をプレーンテキストにする。手元のメモや
// チャットへ貼って読むためのもので、Markdown の見出し記号は貼り先で
// そのまま読めるよう軽いものだけ使う
import { formatJstDateTime } from '../datetime'
import type { HealthLevel, InfoSection, ServerInfo } from './types'

export const LEVEL_LABEL: Readonly<Record<HealthLevel, string>> = {
  ok: 'OK',
  warn: '注意',
  error: '異常',
}

export const SECTION_FAILED_PREFIX = '取得できませんでした'

function formatSection(section: InfoSection): string[] {
  const body =
    section.result.kind === 'failed'
      ? [`${SECTION_FAILED_PREFIX}: ${section.result.message}`]
      : section.result.rows.map((row) => `${row.label}: ${row.value}`)
  return ['', `## ${section.title}`, ...body]
}

export function formatServerInfo(info: ServerInfo): string {
  return [
    `# サーバー情報 (${formatJstDateTime(info.collectedAt)})`,
    '',
    `## ヘルスチェック: ${LEVEL_LABEL[info.overall]}`,
    ...info.checks.map((c) => `[${LEVEL_LABEL[c.level]}] ${c.name}: ${c.detail}`),
    ...info.sections.flatMap(formatSection),
  ].join('\n')
}
