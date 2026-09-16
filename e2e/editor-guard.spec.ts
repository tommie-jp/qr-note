import type { Page } from '@playwright/test'
import { E2E_ITEM_PREFIX } from './env'
import {
  clearEditor,
  closePage,
  expect,
  expectHydrated,
  memoEditor,
  newLoggedInPage,
  test,
} from './helpers'
import { removeE2eNote } from './notes'

// 編集まわりの既存の不具合の回帰テスト (2026-09-17 に修正):
//
//   1. チェックを押して本文が黙って追随した直後・「別の版を読み込む」の直後に、
//      何も打っていないのに離脱の確認が出ていた (UnsavedGuard の基準が、新しい
//      本文が DOM に入る前に取られていた)
//   2. 保存が済んだ下書きが localStorage に残り、後で本文が別の経路で変わると
//      古い基点のまま復元されて競合バナーになっていた
const FOLLOW_NO = `${E2E_ITEM_PREFIX}2`
const DRAFT_NO = `${E2E_ITEM_PREFIX}3`
const STAMP = Date.now()

// 3 本とも自分でノートを作る (同じ番号を上書き) ので、単独でも順不同でも走る。
//
// UnsavedGuard の判定だけを取り出す。本物の離脱は Playwright では確認
// ダイアログで固まるので起こさない (e2e/README.md)。preventDefault されたら
// 「未保存の変更がある」と判定した印
async function wouldBlockUnload(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
}

// 送信値の正本 (MemoEditor の hidden input)。エディタが追随したかはここで見る
function memoField(page: Page) {
  return page.locator('input[name="memo"]')
}

function saveButton(page: Page) {
  return page.getByRole('button', { name: '更新', exact: true })
}

async function createNote(page: Page, itemNo: string, body: string): Promise<void> {
  await page.goto(`/edit/${itemNo}`)
  await expect(saveButton(page)).toBeVisible()
  await clearEditor(page)
  await memoEditor(page).pressSequentially(body, { delay: 10 })
  await saveButton(page).click()
  await expect(page).toHaveURL((url) => url.pathname === `/item/${itemNo}`)
  // 「- [ ] 」はチェックボックスに描かれるので、本文の文字の部分で確かめる
  await expect(page.getByText(body.replace(/^- \[[ x]\] /, '')).first()).toBeVisible()
}

test.describe('編集画面の離脱確認と下書き', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, FOLLOW_NO)
    await removeE2eNote(page, DRAFT_NO)
    await closePage(page)
  })

  test.afterAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, FOLLOW_NO)
    await removeE2eNote(page, DRAFT_NO)
    await closePage(page)
  })

  test('チェックを押して黙って追随した直後は、離脱の確認を出さない', async ({ page }) => {
    // Arrange: 編集タブを一度開いてエディタを乗せてから、markdown タブに戻る
    await createNote(page, FOLLOW_NO, `- [ ] ${E2E_ITEM_PREFIX} task ${STAMP}`)
    await page.getByRole('tab', { name: '編集' }).click()
    await expect(memoEditor(page)).toBeVisible()
    await page.getByRole('tab', { name: 'markdown' }).click()
    expect(await wouldBlockUnload(page)).toBe(false)

    // Act: チェックを押す → サーバーアクション → 再描画 → エディタが黙って追随
    const box = page.getByRole('checkbox').first()
    await expectHydrated(box)
    await box.check()
    await expect(memoField(page)).toHaveValue(/- \[x\]/)

    // Assert
    expect(await wouldBlockUnload(page)).toBe(false)
  })

  test('「別の版を読み込む」の直後は、離脱の確認を出さない', async ({ page, browser }) => {
    // Arrange: こちらで打ちかけている間に、別のページが別の本文を保存する
    await createNote(page, FOLLOW_NO, `- [ ] ${E2E_ITEM_PREFIX} task ${STAMP}`)
    await page.getByRole('tab', { name: '編集' }).click()
    await expect(memoEditor(page)).toBeVisible()
    await memoEditor(page).click()
    await page.keyboard.press('End')
    await memoEditor(page).pressSequentially(' ours', { delay: 10 })

    const theirs = `- [x] ${E2E_ITEM_PREFIX} task ${STAMP} theirs`
    const other = await newLoggedInPage(browser)
    await createNote(other, FOLLOW_NO, theirs)
    await closePage(other)

    // Act: 保存すると競合になる → 別の版を読み込む。
    // 競合の応答はページを再描画しないので props は古いまま。読み込んだ本文が
    // その古い props に引き戻されないこと (2026-09-17 に修正) も、ここで見る
    await saveButton(page).click()
    await page.getByRole('button', { name: '別の版を読み込む' }).click()
    await expect(memoField(page)).toHaveValue(theirs)
    await page.waitForTimeout(500)
    await expect(memoField(page)).toHaveValue(theirs)

    // Assert
    expect(await wouldBlockUnload(page)).toBe(false)
  })

  test('保存が済んだら下書きは消える', async ({ page }) => {
    // Arrange: 打って、下書きが localStorage に書かれるまで待つ
    const key = `qr-search:memo-draft:${DRAFT_NO}`
    const draft = () => page.evaluate((k) => window.localStorage.getItem(k), key)
    await page.goto(`/edit/${DRAFT_NO}`)
    await expect(saveButton(page)).toBeVisible()
    await clearEditor(page)
    await memoEditor(page).pressSequentially(`${E2E_ITEM_PREFIX} draft ${STAMP}`, { delay: 10 })
    await expect.poll(draft).not.toBeNull()

    // Act
    await saveButton(page).click()
    await expect(page).toHaveURL((url) => url.pathname === `/item/${DRAFT_NO}`)

    // Assert
    await expect.poll(draft).toBeNull()
  })
})
