import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test'
import { collectCoverage, startCoverage } from './coverage'
import { AUTH_FILE, BASE_URL } from './env'

// ブラウザを駆動するときの罠をコードにしたもの (.claude/skills/verify/SKILL.md)。
// spec は `@playwright/test` ではなくここの test / expect を使う

// --- dev オーバーレイ ---

// Next.js の dev オーバーレイ (<nextjs-portal>) は画面左下で pointer events を
// 奪い、下部操作バーの左端などがクリックできずにタイムアウトする。本番には
// 無い要素なので退ける。
//
// addStyleTag ではなく init script で入れる — addStyleTag は今の文書にしか
// 効かず、ハードナビゲーションのたびに消える
const HIDE_DEV_OVERLAY_SCRIPT = `(() => {
  const inject = () => {
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal { display: none !important; }';
    (document.head ?? document.documentElement).appendChild(style);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  } else {
    inject();
  }
})()`

// --- 検索履歴を書かない ---

// 検索結果を開く・Enter で検索する、は検索履歴 (search_queries) への記録を
// 伴う (docs/59-検索候補計画.md §2)。E2E の利用者名の行とはいえローカル DB に
// 残るので、書き込み (POST/PUT/DELETE) はサーバへ届けず、いまのリスト (GET の
// 答え) をそのまま返す。読みは素通しする。
//
// 落とす (abort) にしないのは、失敗した記録をクライアントが console.warn し、
// それがブラウザログとして dev サーバの /logs に転送されるため
const SEARCH_HISTORY_ROUTE = '**/api/search-queries**'
const SEARCH_HISTORY_READ = `${BASE_URL}/api/search-queries`

async function prepareContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(HIDE_DEV_OVERLAY_SCRIPT)
  await context.route(SEARCH_HISTORY_ROUTE, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fallback()
      return
    }
    // context.request は画面と cookie を共有する (ログイン済みで読める)
    const current = await context.request.get(SEARCH_HISTORY_READ)
    await route.fulfill({ response: current })
  })
}

// フィクスチャの第 2 引数は慣例では `use` だが、その名前だと eslint の
// react-hooks/rules-of-hooks が React の use() と取り違えるので provide と呼ぶ
export const test = base.extend({
  context: async ({ context }, provide) => {
    await prepareContext(context)
    await provide(context)
  },
  // E2E_COVERAGE=1 のときだけカバレッジを取る (coverage.ts)
  page: async ({ page }, provide) => {
    await startCoverage(page)
    await provide(page)
    await collectCoverage(page)
  },
})

export { expect }

// フック (beforeAll / afterAll) からログイン済みのページを開く。
// フックでは page フィクスチャが使えないので、同じ下ごしらえを手で当てる
export async function newLoggedInPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: AUTH_FILE,
  })
  await prepareContext(context)
  const page = await context.newPage()
  await startCoverage(page)
  return page
}

// newLoggedInPage / newTouchPage で開いたページをコンテキストごと閉じる。
// 閉じる前にカバレッジを回収する (閉じたページからは取れない)
export async function closePage(page: Page): Promise<void> {
  await collectCoverage(page)
  await page.context().close()
}

// --- ハイドレーション ---

// 検索窓。aria-label は無く、名前は placeholder から付く
export function searchBox(page: Page): Locator {
  return page.getByRole('combobox')
}

// 検索窓に打ち込み、URL の ?q= が変わるまで待つ。
//
// **これがハイドレーション待ちを兼ねる。** dev は初回コンパイルを挟むので、
// 描画直後に打つと React のハンドラがまだ付いておらず、何も起きない
// (アプリのバグに見える)。固定の sleep ではなく「打鍵で URL が変わった」を
// React が生きている証拠として取り、変わらなければ打ち直す。
//
// 今の URL が既に ?q=<query> だと証拠にならないので、そこから呼ばない
export async function searchFor(page: Page, query: string): Promise<void> {
  const current = new URL(page.url()).searchParams.get('q')
  if (current === query) {
    throw new Error(`既に ?q=${query} を開いている。打鍵の証拠が取れない`)
  }
  const box = searchBox(page)
  await expect(box).toBeVisible()
  await expect(async () => {
    await box.fill('')
    await box.pressSequentially(query, { delay: 30 })
    await expect(page).toHaveURL(
      (url) => url.searchParams.get('q') === query,
      { timeout: 3_000 },
    )
  }).toPass({ timeout: 60_000 })
}

// その要素を React がハイドレートし終えたか (props を DOM に結び付けたか)。
//
// 検索窓の無い画面 (ゴミ箱など) で、クリックの前に「ハンドラが付いている」を
// 確かめる。window.confirm を挟むボタン (ConfirmSubmitButton) はハイドレート前に
// 押すと、確認を出さずに素の form 送信として走ってしまう。
// `__reactProps$` は React がハイドレート時に DOM へ付ける内部キー
// (React 16〜19 で不変)。変わったらここだけ直す
export async function expectHydrated(locator: Locator): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate((el) =>
        Object.keys(el).some((key) => key.startsWith('__reactProps$')),
      ),
    )
    .toBe(true)
}

// --- 編集画面 ---

// 編集中の本文 (CodeMirror)。マウント後にしか現れない
export function memoEditor(page: Page): Locator {
  return page.locator('.cm-content')
}

// 本文を消す。**dirty なエディタで reload / goto しない** — beforeunload
// (UnsavedGuard) の確認が出て、Playwright は既定でそれを dismiss する
// (= 離脱が取り消されて goto が失敗する)。やり直したいときはこれで消す
export async function clearEditor(page: Page): Promise<void> {
  await memoEditor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
}

// --- ファイル選択 ---

export interface InjectedFile {
  name: string
  mimeType: string
  buffer: Buffer
}

// <input type="file"> へファイルを直接入れる。
//
// ボタンを押して file chooser を待つ形にしない。chooser 経由と直接注入が
// 二重に走ると change が 2 回届き、アプリのバグに見える (verify skill の罠)。
// setInputFiles は input に直接入れて change を 1 回だけ出す
export async function injectFiles(
  input: Locator,
  files: InjectedFile[],
): Promise<void> {
  await input.setInputFiles(files)
}

// --- タッチ ---

// touchmove を使う実装 (スクロールでキーボードを閉じる等) は、既定の
// コンテキストではイベントがそもそも出ない。hasTouch の別コンテキストを
// ログイン済みで開く
export async function newTouchPage(
  browser: Browser,
  viewport = { width: 375, height: 812 },
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: AUTH_FILE,
    hasTouch: true,
    isMobile: true,
    viewport,
  })
  await prepareContext(context)
  const page = await context.newPage()
  await startCoverage(page)
  return page
}

// --- レスポンシブ ---

// ページごと横にスクロールするか。スクショの目視では見落とすので数値で見る
export async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
}
