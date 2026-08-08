// ログインなしで開いてよいパス (docs/18-ログイン計画.md)。
//
// かつては nginx / Caddy 側の @pwa_public / `auth_basic off` がこの役目を
// 持っていた。認証をアプリへ移した以上、その一覧もここへ移す。
// エッジとアプリの二か所に散らすと、片方だけ直して穴が開く。
//
// 判定は「一覧に載っているものだけ公開」。前方一致は使わない —
// '/docs' で始まるものを通すと '/docsecret' まで開いてしまう。

import manifest from '@/app/manifest'
import { PUBLIC_AUTH_PATHS } from './authPaths'
import { LOGIN_PATH, LOGIN_REQUIRED_PATH } from './loginRedirect'
import { OFFLINE_PATH } from './offline/params'
import { isValidAttachmentName } from './uploads'
import { isValidItemNo } from './validation'

// PWA: ブラウザは manifest とアイコンを Authorization ヘッダなしで取りに行く。
// 閉じると 401 になり「インストール可能」と判定されない。
// どちらも秘密を含まないので公開してよい。
//
// アイコンは manifest.ts から導出する。手で並べると、アイコンを足したとき
// ここを直し忘れて PWA が黙って壊れる (実際 icon-512.png を書き落とした)。
// manifest が要求するものは必ず取れる、を構造で保証する
function pwaPaths(): Set<string> {
  const iconSrcs = (manifest().icons ?? [])
    .map((icon) => icon.src)
    .filter((src): src is string => typeof src === 'string')

  return new Set([
    '/manifest.webmanifest',
    ...iconSrcs,
    // manifest には載らないが、ブラウザが自分で取りに行くもの。
    // icon.svg はタブの favicon、apple-icon.png は iOS のホーム画面
    // (どちらも app/ 直下の特別ファイルで Next.js が配信する)
    '/icon.svg',
    '/apple-icon.png',
    // Service Worker 本体 (public/sw.js。docs/65-オフライン対応計画.md §5)。
    // 閉じるとログイン案内の HTML が sw.js として返り、登録が
    // 「スクリプトの MIME が違う」で失敗する。中身は静的な JS で秘密を含まない
    '/sw.js',
    // オフラインの画面 (app/offline/page.tsx)。**ノートを 1 件も含まない殻**で、
    // 中身は端末の IndexedDB からしか来ない。開けてある理由は 2 つ:
    //   - 閉じたままだと Service Worker が殻を保存するとき、ログイン案内
    //     (200 で返る) をノートの画面として抱え込む余地が残る
    //   - 圏外ではログインし直せない。セッションが切れても、既に端末にある
    //     ノートは読めるべき
    OFFLINE_PATH,
  ])
}

// 使い方の説明。ノートの中身は出ず、リポジトリの docs/*.md をそのまま
// 表示しているだけなので公開してよい (app/docs/*/page.tsx)
const DOCS_PATHS = new Set(['/docs/search', '/docs/memo'])

// robots.txt はクローラが認証なしで取りに行く (docs/39-デモ公開計画.md §3)。
// 秘密を含まず、むしろ「デモは disallow」を伝えるために**必ず届く**必要がある。
// ゲートすると app/robots.ts の内容ではなくログイン画面 (200) が返り、
// クローラには「robots 指示が無い = 全許可」に見えてしまい disallow が効かない。
const CRAWLER_PATHS = new Set(['/robots.txt'])

// ログインの入口そのもの。閉じるとログインできない。
//
// パスキーのログイン 2 口もここに入る (docs/29-パスキー計画.md §6)。
// **登録の口は入らない** — 一覧は authPaths.ts の PUBLIC_AUTH_PATHS が正本で、
// あちらに「登録側を入れてはいけない」理由を書いた
const LOGIN_PATHS = new Set([LOGIN_PATH, LOGIN_REQUIRED_PATH, ...PUBLIC_AUTH_PATHS])

// manifest() は APP_ENV を読む (色を変えるため) が、パスの一覧は環境で
// 変わらない。毎リクエスト組み直す必要はないので一度だけ作る
let pwaPathsCache: Set<string> | null = null

export function isPublicPath(pathname: string): boolean {
  pwaPathsCache ??= pwaPaths()
  return (
    LOGIN_PATHS.has(pathname) ||
    pwaPathsCache.has(pathname) ||
    DOCS_PATHS.has(pathname) ||
    CRAWLER_PATHS.has(pathname)
  )
}

// --- 自前で判定する口 (docs/22-ノート公開計画.md §1) ---
//
// 公開かどうかが**パスではなくデータで決まる**もの。トグルを押すたびに
// この一覧が書き換わる作りにはできないので、判定を二段に分ける。
//
//   isPublicPath      … 誰でも見てよい (静的に決まる)
//   isSelfGuardedPath … proxy では決められない。読み取りだけ通し、ページと
//                       route handler が isPublicItem() で確かめる
//
// **ここに載せる = 無条件公開ではない**。載せた口には必ず自前の判定が要る。
// 逆に、一覧に書いてある口だけが素通しされるので、新しいページを足したときに
// 黙って公開されることはない (既定が閉じている、は保たれる)。
//
// 素通しするのは GET/HEAD だけ (proxy.ts)。書き込み (Server Action の POST) は
// 門番で止める。公開ノートは読み取り専用であって、誰でも書ける口にはしない。

// パスの末尾に itemNo を取るもの。/item は本文、/print は QR シール
// (公開ビューにも QR ボタンを出すため。docs/22 §5)
const ITEM_NO_PREFIXES = ['/item/', '/print/']

// メモに貼った画像・音声。閉じたままだと公開ノートを開いた人に画像だけ割れ、
// 音声も再生できない (docs/22 §6, docs/12-添付ファイル種類拡張メモ.md)
const IMAGE_PREFIX = '/api/images/'

// 末尾は itemNo / 画像名の書式に**完全一致**すること。前方一致で通すと
// '/item/4518/edit' のような、別のページを指すパスまで素通しする
export function isSelfGuardedPath(pathname: string): boolean {
  const itemNoPrefix = ITEM_NO_PREFIXES.find((prefix) => pathname.startsWith(prefix))
  if (itemNoPrefix !== undefined) {
    return isValidItemNo(pathname.slice(itemNoPrefix.length))
  }

  if (pathname.startsWith(IMAGE_PREFIX)) {
    return isValidAttachmentName(pathname.slice(IMAGE_PREFIX.length))
  }

  return false
}
