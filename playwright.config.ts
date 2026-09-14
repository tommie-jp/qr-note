import { defineConfig, devices } from '@playwright/test'
import { hashSync } from 'bcryptjs'
import { AUTH_FILE, BASE_URL, E2E_PASSWORD, E2E_USER } from './e2e/env'

// スモーク E2E (docs/93-リファクタリング計画.md §7-4)。手順と罠は e2e/README.md。
//
// dev サーバは既定では起動しない。ローカル DB を使う dev サーバは手元で
// 立ち上げたままにしておくことが多く、テストのたびに起動すると初回コンパイルを
// 毎回待つことになる。E2E_START_SERVER=1 のときだけ Playwright が起動する
// (その場合もテスト用の資格情報を env で上書きする)

const shouldStartServer = process.env.E2E_START_SERVER === '1'

// dev サーバの初回コンパイルはページごとに数秒〜十数秒かかる (Turbopack)。
// 既定の 30 秒だとコンパイル待ちで落ちる
const TEST_TIMEOUT_MS = 120_000
const EXPECT_TIMEOUT_MS = 20_000
const NAVIGATION_TIMEOUT_MS = 90_000
const SERVER_START_TIMEOUT_MS = 300_000

// webServer に渡す BASIC_AUTH_HASH_B64 (npm run hash-password と同じ形)。
// 生の bcrypt ハッシュは `$` を含み env の読み込みで壊れるので base64 で渡す
// (理由は src/lib/auth/basicAuth.ts)。コストはアプリの検算に従うので 10 で足りる
const E2E_HASH_COST = 10

function basicAuthHashB64(password: string): string {
  return Buffer.from(hashSync(password, E2E_HASH_COST), 'utf8').toString('base64')
}

export default defineConfig({
  testDir: 'e2e',
  // 1 本の dev サーバと 1 つのローカル DB を共有するので直列で流す。
  // 並べても初回コンパイルの取り合いで遅くなるだけ
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: EXPECT_TIMEOUT_MS },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: NAVIGATION_TIMEOUT_MS,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts$/,
      teardown: 'teardown',
    },
    {
      name: 'teardown',
      testMatch: /auth\.teardown\.ts$/,
      use: { storageState: AUTH_FILE },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
  ],
  webServer: shouldStartServer
    ? {
        command: `npm run dev -- -p ${new URL(BASE_URL).port || '3210'}`,
        // 公開パス (auth/publicPaths.ts)。ログインしていなくても 200 が返る
        url: `${BASE_URL}/login-required`,
        reuseExistingServer: false,
        timeout: SERVER_START_TIMEOUT_MS,
        env: {
          BASIC_AUTH_USER: E2E_USER,
          BASIC_AUTH_HASH_B64: basicAuthHashB64(E2E_PASSWORD),
        },
      }
    : undefined,
})
