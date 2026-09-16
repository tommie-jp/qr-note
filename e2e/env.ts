import path from 'node:path'

// E2E の接続先と資格情報 (e2e/README.md)。
//
// 設定 (playwright.config.ts) と spec の両方が読むので、`@playwright/test` の
// test を import しない葉に置く。config から test を import すると、設定の
// 読み込み中に test が作られて Playwright に断られる

// 127.0.0.1 ではなく localhost。proxy.ts が非本番のループバック IP を
// localhost へ 307 で送り直すので、127.0.0.1 で開くと cookie の持ち主が
// 食い違って転送が輪になる
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3210'

// dev サーバに env で渡すテスト専用の資格情報 (本番やふだんの .env の値とは
// 別物にする。README の「テスト」節で hash を作って BASIC_AUTH_* を上書きする)
export const E2E_USER = process.env.E2E_USER ?? 'e2e'
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-test-pass'

// setup プロジェクトが保存するセッション cookie (.gitignore 済み)
export const AUTH_FILE = path.join(__dirname, '.auth', 'session.json')

// E2E が作るノートの番号の頭。ローカル DB には本物のノートが入っているので、
// **この頭を持たない番号は決して書き換え・ゴミ箱・永久削除しない**
// (統合テストの `zzft` と同じ流儀。notes.ts の assertE2eItemNo が門番)
export const E2E_ITEM_PREFIX = 'zze2e'

// シークレットの E2E (secrets.spec.ts) が向く専用 DB の接続文字列 (docs/96 §4-3)。
// 設定 (webServer) が dev サーバに DATABASE_URL として渡し、spec は下の
// secretsDbProblem で「専用 DB に向いている」ことを確かめてから走る
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL

// 手元の本物の DB の名前。**ここへは決して向けない** — 鍵束 (secret_keyring) は
// 1 行しか持てず、断片には消す口が無いので、走らせた跡が本物に残る
const REAL_DB_NAME = 'qr'

// シークレットの E2E を走らせてはいけない理由。走らせてよければ null。
// spec はこれを skip の理由にそのまま出す (黙って skip にしない)
export function secretsDbProblem(): string | null {
  if (E2E_DATABASE_URL === undefined || E2E_DATABASE_URL === '') {
    return 'E2E_DATABASE_URL が無い (scripts/e2eDb.sh url の値を渡す)'
  }
  let name: string
  try {
    name = new URL(E2E_DATABASE_URL).pathname.slice(1)
  } catch {
    return 'E2E_DATABASE_URL が URL として読めない'
  }
  if (name === '') {
    return 'E2E_DATABASE_URL に DB 名が無い'
  }
  if (name === REAL_DB_NAME) {
    return `E2E_DATABASE_URL が本物の DB (${REAL_DB_NAME}) を指している`
  }
  return null
}
