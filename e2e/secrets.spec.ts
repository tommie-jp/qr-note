import type { Page, Request } from '@playwright/test'
import { BASE_URL, E2E_ITEM_PREFIX, secretsDbProblem } from './env'
import {
  clearEditor,
  closePage,
  expect,
  expectHydrated,
  injectFiles,
  memoEditor,
  newLoggedInPage,
  test,
} from './helpers'
import { removeE2eNote } from './notes'
import { attachVirtualAuthenticator } from './webauthn'

// シークレット (部分暗号化。docs/51-部分暗号化計画.md) の一連の流れ (docs/96 §4-3):
// パスキー登録 → 暗号化の設定 (復旧キー) → 解錠 (パスキー・復旧キー) →
// 編集画面から断片を書く → 閲覧画面で復号・コピー → 入れ子の画像 →
// 平文がサーバへ出ていないこと。前の段が作った物を次の段が使うので直列。
//
// **専用 DB でしか走らない。** 鍵束 (secret_keyring) は 1 行しか持てず、断片には
// 消す口が無い (docs/51 §11 の GC は未実装)。E2E_DATABASE_URL が無い・本物の
// qr を指しているときは skip する。走らせ方は e2e/README.md
// (scripts/e2eDb.sh create → 流す → drop)。**2 回目は作り直してから** — 鍵束が
// 残っていると「設定する」が 409 で断られ、前の回の仮想認証器 (閉じた時点で
// 消えている) でしか開けない鍵束だけが残る
//
// 認証器は仮想 (e2e/webauthn.ts)。1 本の CDP セッションに付けた 1 枚のページを
// beforeAll から afterAll まで使い回す — 別のページを開くと認証器が付いてこない
const ITEM_NO = `${E2E_ITEM_PREFIX}-s1`
const PASSKEY_LABEL = E2E_ITEM_PREFIX
const STAMP = Date.now()

// 断片に書く平文。**ブラウザの console に出さない** — dev はブラウザのログを
// /logs へ転送する (docs/30)。Playwright 側の失敗表示に出るぶんは手元に閉じる
const SECRET_TEXT = `${E2E_ITEM_PREFIX} secret ${STAMP} ひみつ`

// ラベル欄を空で保存したときの表示名 (lib/secret/secrets.ts の DEFAULT_SECRET_LABEL)
const DEFAULT_LABEL = 'シークレット'

// 断片の口。名前は UUID (lib/secret/secrets.ts)
const SECRET_API = '/api/secrets/'
const KEYRING_PATH = `${SECRET_API}keyring`
const SECRET_NAME = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// 復旧キーの形 (lib/secret/keyring.ts: 32 バイト = base32 52 文字を 4 文字ずつ
// '-' で区切る = 13 組)。画面から拾うときの目印
const RECOVERY_KEY_RE = /^[0-9A-Z]{4}(?:-[0-9A-Z]{4}){12}$/

// 入れ子の画像に使う 1x1 の PNG。canvas で描き直され (lib/secret/image.ts)、
// webp として別の断片に封をされる
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

// サーバへ出た要求の控え。平文が出ていないことを最後に確かめる
interface SecretRequest {
  method: string
  path: string
  // 復号後の種別を申告するヘッダ (lib/secret/payload.ts の SECRET_MIME_HEADER)
  mime: string | null
  body: Buffer | null
}

// 形は正しいが中身の違う復旧キー。**先頭**の 1 文字を別の文字にする — 末尾の
// 文字は下位 4 ビットが詰め物なので、変えても同じ鍵に戻ることがある
function wrongRecoveryKey(key: string): string {
  return (key.startsWith('A') ? 'B' : 'A') + key.slice(1)
}

// 送信値の正本 (MemoEditor の hidden input)。記法が本文に入ったかはここで見る
function memoField(page: Page) {
  return page.locator('input[name="memo"]')
}

function secretBody(page: Page) {
  return page.getByRole('textbox', { name: /^中身/ })
}

function sealButton(page: Page) {
  return page.getByRole('button', { name: '暗号化して保存', exact: true })
}

// 通知・失敗の文言。**main の中だけ**で探す — dev では console.error の内容が
// エラーオーバーレイ (<nextjs-portal>) にも出て、同じ文字が 2 か所になる
// (fixture が隠しているが、locator の解決は隠れていても数える)
function notice(page: Page, text: string) {
  return page.getByRole('main').getByText(text, { exact: true })
}

function lockedBlock(page: Page) {
  return page.getByRole('button', { name: new RegExp(`🔒\\s*${DEFAULT_LABEL}`) })
}

test.describe.configure({ mode: 'serial' })

test.describe('シークレット (専用 DB + 仮想認証器)', () => {
  const problem = secretsDbProblem()
  test.skip(problem !== null, problem ?? '')

  let sharedPage: Page | undefined
  // 初回設定のときに画面から控える。**console に出さない**
  let recoveryKey = ''
  const secretRequests: SecretRequest[] = []
  // 宛先を問わず、本文を持つ要求すべて (ノートの保存も含む)
  const allBodies: Buffer[] = []

  function record(request: Request): void {
    const body = request.postDataBuffer()
    if (body !== null) {
      allBodies.push(body)
    }
    const { pathname } = new URL(request.url())
    if (pathname.startsWith(SECRET_API)) {
      secretRequests.push({
        method: request.method(),
        path: pathname,
        mime: request.headers()['x-secret-mime'] ?? null,
        body,
      })
    }
  }

  test.beforeAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    sharedPage = page
    // コピーの確認にクリップボードを読む
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL })
    page.on('request', record)
    await attachVirtualAuthenticator(page)
    // 前の回が途中で落ちて残した同じ番号を消しておく (無ければ何もしない)
    await removeE2eNote(page, ITEM_NO)
  })

  test.afterAll(async () => {
    if (sharedPage === undefined) {
      return
    }
    await removeE2eNote(sharedPage, ITEM_NO)
    await closePage(sharedPage)
  })

  // 以下のテストは beforeAll が用意したページを使う (page フィクスチャは使わない)
  function shared(): Page {
    if (sharedPage === undefined) {
      throw new Error('beforeAll がページを用意していない')
    }
    return sharedPage
  }

  test('専用 DB は鍵束もパスキーも空から始まる', async () => {
    // Arrange / Act
    const page = shared()
    await page.goto('/settings/passkeys')

    // Assert: 本物の DB ならパスキーが並ぶ。鍵束が残っていたら作り直してもらう
    await expect(
      page.getByText('まだ登録されていません。'),
      '専用 DB にパスキーが残っている。scripts/e2eDb.sh drop && scripts/e2eDb.sh create で作り直す',
    ).toBeVisible()
    await page.goto('/settings/secrets')
    await expect(
      page.getByText('まだ設定していません。'),
      '鍵束が既にある (2 回目以降は作り直してから)。scripts/e2eDb.sh drop && scripts/e2eDb.sh create',
    ).toBeVisible()
  })

  test('仮想認証器でパスキーを登録できる', async () => {
    // Arrange
    const page = shared()
    await page.goto('/settings/passkeys')
    const name = page.getByRole('textbox', { name: /^名前/ })
    const register = page.getByRole('button', { name: 'この端末を登録', exact: true })
    await expectHydrated(register)

    // Act
    await name.fill(PASSKEY_LABEL)
    await register.click()

    // Assert: 一覧 (Server Component) が描き直されて並ぶ (登録日と「未使用」を伴う)
    const row = page.getByRole('listitem').filter({ hasText: PASSKEY_LABEL })
    await expect(row).toBeVisible()
    await expect(row).toContainText('未使用')
  })

  test('暗号化を設定すると復旧キーが出て、解錠中になる', async () => {
    // Arrange: 「設定する」は鍵束を読み終えるまで disabled (= ハイドレート待ちも兼ねる)
    const page = shared()
    await page.goto('/settings/secrets')
    const setup = page.getByRole('button', { name: '設定する', exact: true })
    await expect(setup).toBeEnabled()

    // Act: マスターキーを作り、パスキー (PRF) で包んで保存 → 復旧キーを表示
    await setup.click()

    // Assert
    const shown = page.getByText(RECOVERY_KEY_RE)
    await expect(shown).toBeVisible()
    recoveryKey = (await shown.innerText()).trim()
    expect(RECOVERY_KEY_RE.test(recoveryKey)).toBe(true)
    await page.getByRole('button', { name: '控えたので閉じる', exact: true }).click()
    await expect(shown).toHaveCount(0)
    await expect(page.getByText(/いまは解錠中です/)).toBeVisible()
    await expect(
      page.getByRole('listitem').filter({ hasText: PASSKEY_LABEL }),
    ).toContainText('解錠に使えます')
  })

  test('再読込で施錠され、パスキーで解錠できる', async () => {
    // Arrange: 鍵はタブのメモリだけ (lib/secret/session.ts)。再読込で消える
    const page = shared()
    await page.reload()
    await expect(page.getByText(/いまは施錠中です/)).toBeVisible()

    // Act
    await page.getByRole('button', { name: 'パスキーで解錠', exact: true }).click()

    // Assert
    await expect(notice(page, '解錠しました')).toBeVisible()
    await expect(page.getByText(/いまは解錠中です/)).toBeVisible()
  })

  test('復旧キーで解錠できる (違うキーは断られる)。施錠するとまた施錠中になる', async () => {
    // Arrange
    const page = shared()
    await page.reload()
    await expect(page.getByText(/いまは施錠中です/)).toBeVisible()
    const input = page.getByRole('textbox', { name: /^復旧キーで解錠/ })
    const unlock = page.getByRole('button', { name: '復旧キーで解錠', exact: true })

    // Act / Assert: 形は正しいが違うキー → 検証値と噛み合わず断られる
    await input.fill(wrongRecoveryKey(recoveryKey))
    await unlock.click()
    await expect(notice(page, '復旧キーが違います')).toBeVisible()
    await expect(page.getByText(/いまは施錠中です/)).toBeVisible()

    // Act / Assert: 控えたキー → 解錠
    await input.fill(recoveryKey)
    await unlock.click()
    await expect(notice(page, '復旧キーで解錠しました')).toBeVisible()
    await expect(page.getByText(/いまは解錠中です/)).toBeVisible()

    // Act / Assert: 施錠
    await page.getByRole('button', { name: '施錠する', exact: true }).click()
    await expect(notice(page, '施錠しました')).toBeVisible()
    await expect(page.getByText(/いまは施錠中です/)).toBeVisible()
  })

  test('編集画面の「秘密」で書いた本文は、記法だけが本文に入る', async () => {
    // Arrange: 未登録の番号の編集画面。「更新」は portal で、見えればハイドレート済み
    const page = shared()
    await page.goto(`/edit/${ITEM_NO}`)
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)

    // Act: ダイアログに書いて封をする。goto で鍵は消えているので、保存の前に
    // パスキー (PRF) での解錠が挟まる — 仮想認証器が黙って応える
    await page.getByRole('button', { name: '秘密', exact: true }).click()
    await expect(page.getByText('シークレットを挿入')).toBeVisible()
    await secretBody(page).fill(SECRET_TEXT)
    await sealButton(page).click()

    // Assert: 本文に入るのは記法だけ
    await expect(secretBody(page)).toHaveCount(0)
    await expect(memoField(page)).toHaveValue(
      new RegExp(`^!\\[${DEFAULT_LABEL}\\]\\(${SECRET_API}${SECRET_NAME}\\)$`),
    )
    await expect(memoEditor(page)).not.toContainText(SECRET_TEXT)

    // Act: ノートを保存
    await save.click()

    // Assert: 閲覧画面。平文はどこにも描かれていない
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_NO}`)
    await expect(lockedBlock(page)).toBeVisible()
    await expect(page.getByText(SECRET_TEXT)).toHaveCount(0)
  })

  test('閲覧画面で 🔒 を押すと復号され、コピーでき、隠す・再読込で消える', async () => {
    // Arrange
    const page = shared()
    const locked = lockedBlock(page)
    await expectHydrated(locked)
    const revealed = page.getByText(SECRET_TEXT)

    // Act: 開く
    await locked.click()

    // Assert
    await expect(revealed).toBeVisible()
    await expect(page.getByText(new RegExp(`🔓\\s*${DEFAULT_LABEL}`))).toBeVisible()

    // Act: コピー (60 秒で消える旨が表示に出る。docs/51 §9)
    await page.getByRole('button', { name: 'コピー', exact: true }).click()

    // Assert
    await expect(page.getByRole('button', { name: /^コピーしました/ })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SECRET_TEXT)

    // Act: 隠す
    await page.getByRole('button', { name: '隠す', exact: true }).click()

    // Assert
    await expect(revealed).toHaveCount(0)
    await expect(locked).toBeVisible()

    // Act: 再読込 = 鍵が消える。開き直すにはパスキーがまた要る
    await page.reload()
    await expect(locked).toBeVisible()
    await expect(revealed).toHaveCount(0)
    await expectHydrated(locked)
    await locked.click()

    // Assert
    await expect(revealed).toBeVisible()
  })

  test('閲覧画面の「編集」から画像を足すと、入れ子の断片が Blob URL で出る', async () => {
    // Arrange: 展開中の「編集」(docs/52 §2)。復号した本文がダイアログに入る
    const page = shared()
    await page.getByRole('button', { name: '編集', exact: true }).click()
    await expect(page.getByText('シークレットを編集')).toBeVisible()
    const body = secretBody(page)
    await expect(body).toHaveValue(SECRET_TEXT)
    await expect(body).toBeEnabled()

    // Act: 画像を入れる (file input へ直接。chooser を待つ形と混ぜない)。
    // 描き直し → 別の断片として封 → 参照だけが本文に入る
    await injectFiles(page.locator('input[type="file"][accept="image/*"]'), [
      { name: 'dot.png', mimeType: 'image/png', buffer: TINY_PNG },
    ])

    // Assert
    await expect(body).toHaveValue(
      new RegExp(`!\\[画像\\]\\(${SECRET_API}${SECRET_NAME}\\)`),
    )

    // Act: 同名で上書き保存 → ダイアログが閉じ、開き直される
    await sealButton(page).click()

    // Assert: 入れ子の画像は復号済みの Blob URL で描かれる
    await expect(body).toHaveCount(0)
    const image = page.locator('img[src^="blob:"]')
    await expect(image).toHaveCount(1)
    await expect(image).toHaveAttribute('alt', '画像')
    await expect(page.getByText(SECRET_TEXT)).toBeVisible()

    // Act / Assert: 隠すと Blob URL も引っ込む
    await page.getByRole('button', { name: '隠す', exact: true }).click()
    await expect(image).toHaveCount(0)
  })

  test('サーバへ届くのは暗号文だけ (平文も復旧キーも出ない)', async () => {
    // Arrange: ここまでの要求の控え
    const puts = secretRequests.filter(
      (request) => request.method === 'PUT' && request.path !== KEYRING_PATH,
    )
    const keyringWrites = secretRequests.filter(
      (request) => request.path === KEYRING_PATH && request.method !== 'GET',
    )

    // Assert: 断片の保存は 3 回 (本文・画像・本文の上書き)。どれも種別ヘッダ付きで、
    // 本文 (暗号文) を伴う
    expect(puts).toHaveLength(3)
    for (const put of puts) {
      expect(put.path).toMatch(new RegExp(`^${SECRET_API}${SECRET_NAME}$`))
      expect(put.mime).not.toBeNull()
      expect(put.body).not.toBeNull()
      expect(put.body?.byteLength ?? 0).toBeGreaterThan(0)
    }
    expect(puts.map((put) => put.mime)).toEqual([
      'text/markdown',
      expect.stringMatching(/^image\//),
      'text/markdown',
    ])
    // 鍵束には初回設定 (POST) だけが書かれた
    expect(keyringWrites.map((request) => request.method)).toEqual(['POST'])

    // Assert: 平文も復旧キーも、どの要求の本文にも出ていない
    // (ノートの保存 = 本文の送信も含む。docs/51 §8 の「平文は memo を経由しない」)
    const plaintext = Buffer.from(SECRET_TEXT, 'utf8')
    const bareKey = recoveryKey.replace(/-/g, '')
    expect(allBodies.length).toBeGreaterThan(0)
    for (const body of allBodies) {
      expect(body.includes(plaintext)).toBe(false)
      expect(body.includes(recoveryKey)).toBe(false)
      expect(body.includes(bareKey)).toBe(false)
    }
  })
})
