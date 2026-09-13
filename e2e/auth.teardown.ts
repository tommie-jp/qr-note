import { expect, test as teardown } from '@playwright/test'

// ログインで作ったセッション (sessions テーブルの行) を消す。
// 走らせるたびに 90 日有効な行がローカル DB に 1 つずつ溜まるのを避ける。
// 画面 (/login-required) を開いて押す形にしないのは、パスキーが有効な env では
// 案内ページが WebAuthn を自動で始めるため
teardown('セッションを破棄する', async ({ page }) => {
  const response = await page.request.post('/api/auth/logout')
  expect(response.status()).toBe(200)
})
