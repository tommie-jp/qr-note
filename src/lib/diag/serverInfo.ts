// サーバー情報の組み立て (docs/109-サーバー情報計画.md)。
//
// 3 つの収集 (ホスト+コンテナ / QR-Note / DB) を並行に走らせ、節ごとに
// 時間制限を掛ける。1 つが投げても・固まっても、他の節は出す。失敗した節は
// 「取得できませんでした」+ 理由として画面に残し、サーバログにも warn を残す
// (黙って空欄にしない。docs/109 §2)。
//
// 収集の差し替え口 (ServerInfoCollectors) はテストのため
import 'server-only'
import { type AppInfo, collectAppInfo } from './appInfo'
import { collectDbInfo, type DbInfo } from './dbInfo'
import { errorText } from '../errorMessage'
import { safeErrorText } from './safeErrorText'
import { evaluateHealth, type HealthInputs, overallLevel } from './healthChecks'
import { collectHostInfo, type HostInfo } from './hostInfo'
import type { InfoSection, ServerInfo } from './types'
import { withTimeout } from './withTimeout'

// DB が固まっていると画面が永遠に出ない。そういうときこそ見たい画面
export const SECTION_TIMEOUT_MS = 5000

export interface ServerInfoCollectors {
  host(): Promise<HostInfo>
  app(): Promise<AppInfo>
  db(): Promise<DbInfo>
  now(): Date
}

const nodeCollectors: ServerInfoCollectors = {
  host: () => collectHostInfo(),
  app: () => collectAppInfo(),
  db: () => collectDbInfo(),
  now: () => new Date(),
}

// 収集を時間制限つきで走らせ、失敗は値 (null + 理由) にして返す
async function attempt<T>(label: string, task: () => Promise<T>): Promise<{ value: T } | { error: string }> {
  try {
    return { value: await withTimeout(task(), SECTION_TIMEOUT_MS, `${label} の収集`) }
  } catch (error) {
    // /logs に残す。画面には理由だけ出すが、調査では「いつから」が要る
    console.warn(`サーバー情報: ${label} の収集に失敗`, error instanceof Error ? error : new Error(errorText(error)))
    // 画面に出す側は伏せ字と長さ制限を通す (safeErrorText)。/logs には上で生のまま残した
    return { error: safeErrorText(error) }
  }
}

// 収集ごと失敗したとき、節の枠は残して中身を失敗にする (枠が消えると
// 「出ない」と「失敗した」の見分けが付かない)
function failedSections(ids: { id: string; title: string }[], message: string): InfoSection[] {
  return ids.map(({ id, title }) => ({ id, title, result: { kind: 'failed', message } }))
}

const HOST_SECTION_IDS = [
  { id: 'host', title: 'ホスト' },
  { id: 'container', title: 'コンテナ' },
]
const APP_SECTION_IDS = [{ id: 'app', title: 'QR-Note' }]
const DB_SECTION_IDS = [{ id: 'db', title: 'DB' }]

export async function collectServerInfo(deps: ServerInfoCollectors = nodeCollectors): Promise<ServerInfo> {
  const [host, app, db] = await Promise.all([
    attempt('ホスト', () => deps.host()),
    attempt('QR-Note', () => deps.app()),
    attempt('DB', () => deps.db()),
  ])

  const sections: InfoSection[] = [
    ...('value' in host ? host.value.sections : failedSections(HOST_SECTION_IDS, host.error)),
    ...('value' in app ? [app.value.section] : failedSections(APP_SECTION_IDS, app.error)),
    ...('value' in db ? [db.value.section] : failedSections(DB_SECTION_IDS, db.error)),
  ]

  // 取れなかった入力は「不明」として判定へ渡す (healthChecks が注意/異常にする)
  const inputs: HealthInputs = {
    db: 'value' in db ? db.value.health : { kind: 'failed', message: db.error },
    gitRepo: 'value' in app ? app.value.gitRepo : { kind: 'failed', message: app.error },
    memory: 'value' in host ? host.value.memory : null,
    disk: 'value' in app ? app.value.disk : null,
    errorLogCount: 'value' in app ? app.value.errorLogCount : 0,
    rakutenSet: 'value' in app ? app.value.rakutenSet : 0,
    webauthnSet: 'value' in app ? app.value.webauthnSet : 0,
  }
  const checks = evaluateHealth(inputs)

  return { collectedAt: deps.now(), overall: overallLevel(checks), checks, sections }
}
