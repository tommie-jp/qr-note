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
