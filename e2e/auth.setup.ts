import { expect, test as setup } from '@playwright/test'
import { AUTH_FILE, E2E_PASSWORD, E2E_USER } from './env'

// パスワード (Basic) でログインし、セッション cookie を保存する (docs/18)。
//
// **Authorization ヘッダを付けて / を開いても入れない。** アプリが資格情報を
// 見るのは /login の 1 か所だけで、以後はセッション cookie しか見ない
// (proxy.ts は 401 ではなく案内ページへ rewrite する)。/login が返す 401 の
// 挑戦に資格情報で答え、303 で戻ってきたときに cookie が付く。
// httpCredentials は URL に資格情報を埋め込む (`http://user:pass@host/login`)
// のと同じ答え方を、URL やトレースに平文を残さずに行う
setup.use({ httpCredentials: { username: E2E_USER, password: E2E_PASSWORD } })

setup('パスワードでログインしてセッションを保存する', async ({ page }) => {
  await page.goto('/login')

  // 303 で / に戻り、ログインの内側 (検索窓) が出ている
  await expect(page).toHaveURL((url) => url.pathname === '/')
  await expect(page.getByRole('combobox')).toBeVisible()
  const cookies = await page.context().cookies()
  expect(cookies.map((cookie) => cookie.name)).toContain('__Host-qr_session')

  await page.context().storageState({ path: AUTH_FILE })
})
