import { describe, expect, test } from 'vitest'
import manifest from '@/app/manifest'
import { isPublicPath, isSelfGuardedPath } from './publicPaths'

describe('isPublicPath', () => {
  // PWA: ブラウザは manifest とアイコンを Authorization ヘッダなしで取りに行く。
  // ここを閉じると「インストール可能」と判定されない (かつては nginx / Caddy 側の
  // @pwa_public がこの役目を持っていた。移設先がここ)
  test.each([
    '/manifest.webmanifest',
    '/icon.svg',
    '/icon-192.png',
    '/icon-512.png',
    '/icon-512-maskable.png',
    '/apple-icon.png',
  ])('%s is public (PWA needs it without credentials)', (path) => {
    expect(isPublicPath(path)).toBe(true)
  })

  // 上の一覧は手で書いたもの。アイコンが増えたときに書き足し忘れても、
  // manifest が実際に要求するものは必ず開いていることをここで縛る
  // (icon-512.png を一度書き落として PWA を壊しかけた)
  test('every icon the manifest asks for is public', () => {
    const iconSrcs = (manifest().icons ?? []).map((icon) => icon.src)

    expect(iconSrcs.length).toBeGreaterThan(0)
    for (const src of iconSrcs) {
      expect(isPublicPath(src), `${src} は manifest が要求しているのに閉じている`).toBe(true)
    }
  })

  // ログインの入口そのもの。閉じるとログインできない
  test.each(['/login', '/login-required'])('%s is public', (path) => {
    expect(isPublicPath(path)).toBe(true)
  })

  // オフライン対応 (docs/65-オフライン対応計画.md §5)。
  // /sw.js を閉じるとログイン案内の HTML が返って登録が失敗し、/offline を
  // 閉じると Service Worker がその案内をノートの画面として抱え込む
  test.each(['/sw.js', '/offline'])('%s is public (offline shell)', (path) => {
    expect(isPublicPath(path)).toBe(true)
  })

  // 開けてよいのは殻だけ。ノート本文が流れる同期の口は閉じたままにする
  test('/api/sync/items is not public (note bodies)', () => {
    expect(isPublicPath('/api/sync/items')).toBe(false)
  })

  // 使い方の説明にノートの中身は出ない
  test.each(['/docs/search', '/docs/memo'])('%s is public (help text only)', (path) => {
    expect(isPublicPath(path)).toBe(true)
  })

  // robots.txt はクローラが認証なしで取りに行く (docs/39-デモ公開計画.md §3)。
  // ゲートするとログイン画面が返り、デモの disallow が届かない
  test('/robots.txt is public (crawlers fetch it without auth)', () => {
    expect(isPublicPath('/robots.txt')).toBe(true)
  })

  // ここから下が本題。ノートの中身が出る画面は閉じる
  test.each([
    '/',
    '/item/ABC123',
    '/edit/ABC123',
    '/print/ABC123',
    '/trash',
    '/api/images/x.png',
    '/api/books/9784873115658',
    '/api/products/4901234567894',
  ])('%s is not public', (path) => {
    expect(isPublicPath(path)).toBe(false)
  })

  // 前方一致で判定すると /docs にぶら下がっていない別物まで開いてしまう
  test('does not open paths that merely start with a public path', () => {
    expect(isPublicPath('/docsecret')).toBe(false)
    expect(isPublicPath('/login-secrets')).toBe(false)
    expect(isPublicPath('/icon.svg.php')).toBe(false)
    expect(isPublicPath('/item/icon.svg')).toBe(false)
  })
})

// 公開かどうかがデータで決まる口 (docs/22-ノート公開計画.md §1)。
// isPublicPath とは別物: ここに載っても「誰でも見てよい」わけではなく、
// 「proxy では決められないので、読み取りだけ通してページに訊く」という意味。
describe('isSelfGuardedPath', () => {
  test.each([
    '/item/4518',
    '/item/ABC123',
    '/item/100x', // Ver1 由来の非数字 itemNo
    '/print/4518',
    '/api/images/0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e9f.png',
    // 音声も公開ノートで再生できるよう素通しする (docs/12-添付ファイル種類拡張メモ.md)
    '/api/images/0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e9f.mp3',
    '/api/images/0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e9f.m4a',
    '/api/images/0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e9f.wav',
    // PDF も公開ノートから開けるよう素通しする (docs/12-添付ファイル種類拡張メモ.md)
    '/api/images/0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e9f.pdf',
  ])('%s is self-guarded (page/handler decides)', (path) => {
    expect(isSelfGuardedPath(path)).toBe(true)
  })

  // パスキー (docs/29-パスキー計画.md §6)。ログインするための口なので開ける
  test.each([
    '/api/auth/passkey/login-options',
    '/api/auth/passkey/login-verify',
  ])('%s is public so that logging in is possible at all', (path) => {
    expect(isPublicPath(path)).toBe(true)
  })

  // **登録の口は絶対に開けない**。開くと誰でも自分のパスキーを足せてしまい、
  // ログインを通り抜ける鍵を自分で配ることになる
  test.each([
    '/api/auth/passkey/register-options',
    '/api/auth/passkey/register-verify',
    '/api/auth/passkeys',
    '/api/auth/passkeys/abc123',
    '/api/auth/logout',
    '/settings/passkeys',
  ])('%s stays behind the login', (path) => {
    expect(isPublicPath(path)).toBe(false)
  })

  // 自前判定 = 無条件公開ではない。両者を混同すると、公開ノート専用の
  // 判定を書き忘れたページが素通しになる
  test.each(['/item/4518', '/print/4518'])('%s is not unconditionally public', (path) => {
    expect(isPublicPath(path)).toBe(false)
  })

  // 書き込みの口・持ち主専用の画面はここに載せない。載せた瞬間 proxy が
  // 素通しし、requireUser() だけが防波堤になる
  test.each([
    '/',
    '/edit/4518',
    '/trash',
    '/logs',
    '/api/books/9784873115658',
    '/api/products/4901234567894',
  ])('%s is not self-guarded', (path) => {
    expect(isSelfGuardedPath(path)).toBe(false)
  })

  // 末尾は itemNo / 画像名の書式に完全一致すること。前方一致で通すと
  // /items-secret や /item/4518/../../ まで素通しする
  test('does not open paths that merely start with a self-guarded prefix', () => {
    expect(isSelfGuardedPath('/itemsecret')).toBe(false)
    expect(isSelfGuardedPath('/item')).toBe(false)
    expect(isSelfGuardedPath('/item/')).toBe(false)
    expect(isSelfGuardedPath('/item/4518/edit')).toBe(false)
    expect(isSelfGuardedPath('/item/4518/../../trash')).toBe(false)
    expect(isSelfGuardedPath('/printer/4518')).toBe(false)
    expect(isSelfGuardedPath('/api/imagesx/a.png')).toBe(false)
  })

  // 画像名はサーバが発番した UUID + 対応拡張子だけ (uploads.ts と対になる)
  test('rejects image names that are not UUID + known extension', () => {
    expect(isSelfGuardedPath('/api/images/x.png')).toBe(false)
    expect(isSelfGuardedPath('/api/images/../../etc/passwd')).toBe(false)
    expect(isSelfGuardedPath('/api/images/0191f0c4-6f3b-7a1e-9c2d-4b5a6c7d8e9f.svg')).toBe(false)
  })
})
