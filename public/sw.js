// オフライン用の Service Worker (docs/65-オフライン対応計画.md §3-5)。
//
// ## なぜ手書きなのか (Serwist を採らなかった理由)
//
// Serwist / Workbox の中心的な価値は「ビルド成果物の precache マニフェスト」に
// ある。ところがこのアプリでは、それがまるごと空振りする:
//
//   - 全ページが force-dynamic の SSR で、precache できる HTML がビルド後に
//     1 つも無い (残るのは _global-error.html と 500.html だけ)
//   - Turbopack ビルドには per-route のチャンク表 (app-build-manifest.json) が
//     出ない。glob で拾う既定に倒すと public/ (180MB: onnx / paddle-ocr) と
//     .next/static/media (61MB: wasm) まで抱え込む
//   - @serwist/turbopack は route handler 方式で、その import が nft の
//     ファイル追跡から漏れる既知の不具合を抱える (serwist#360)。
//     output: "standalone" は同じ追跡で Docker 用の束を組むので直撃しうる
//
// つまり必要なのは precache ではなく「実行時キャッシュ + 1 ルートだけの
// 意図的な暖機」で、それはこのファイルの長さで書ける。
//
// ## 3 つの約束
//
//   1. **暖機はログイン後に明示的に行う** (register.ts が warm を送る)。
//      未ログインだと proxy.ts が 200 のままログイン案内へ差し替えるので、
//      install 時に勝手に取ると「ノートのつもりでログイン画面」が沈む。
//      /offline は publicPaths に載せてあるため、この口だけは差し替わらない。
//   2. **画面の遷移先は /offline に統一する**。取れなかった URL の場所へ
//      別ページの HTML を返すと、URL と RSC ペイロードが食い違って壊れる。
//      素直に 302 で /offline へ送り、元の行き先は query で渡す。
//   3. **チャンクは HTML から拾う**。Turbopack のチャンク名はビルドごとの
//      ハッシュ付きなので、表を持たず毎回 HTML を読んで数え直す。
//
// バージョンは登録側が ?v= で渡す (register.ts)。中身が同じでも URL が変われば
// ブラウザは新しい Worker として入れ直すので、リリースごとに確実に更新される。

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'

// アプリの殻 (/offline の HTML とその JS/CSS)。版ごとに分ける — 古い版の
// HTML と新しい版のチャンクが混ざると、読み込めないチャンクを指したまま固まる
const SHELL_CACHE = `qr-shell-${VERSION}`
// 添付 (サムネ・画像・動画)。名前が UUID で中身が変わらないので版を分けない。
// 分けるとリリースのたびに数十 MB を落とし直すことになる
const MEDIA_CACHE = 'qr-media-v1'
// 印付きノート (offline_pin) の持ち出し (docs/65-オフライン対応計画.md §10)。
// **MEDIA_CACHE と分けるのが要点。** あちらは上限 600 件で古い順に捨てるので、
// 混ぜると「オフラインで常に使う」と言われた添付が、別のノートを眺めただけで
// 押し出される。こちらに上限は無く、捨てるのは印を外したときだけ。
// 出し入れするのは画面側 (pinCache.ts) で、ここは返すだけ
const PIN_CACHE = 'qr-pin-v1'
// シークレット断片の暗号文 (docs/65-オフライン対応計画.md §9)。
// 置くのは**暗号文だけ**で、鍵はここを通らない (端末に写すのは鍵束 = 包んだ鍵で、
// それは IndexedDB。開けるのは Face ID か復旧キーだけ)
const SECRET_CACHE = 'qr-secret-v1'

const OFFLINE_PATH = '/offline'
const STATIC_PREFIX = '/_next/static/'
const MEDIA_PREFIX = '/api/images/'
const SECRET_PREFIX = '/api/secrets/'
// 鍵束は断片と同じ prefix にぶら下がるが、**キャッシュしてはいけない**。
// 中身は「いまサーバがどう思っているか」で、別の端末でパスキーを足すと変わる。
// 圏外用の写しは IndexedDB が持つ (offline/keyring.ts) — あちらは書き換わった
// ことに気づける (取れたときに必ず上書きする) が、ここに沈めると気づけない
const KEYRING_PATH = '/api/secrets/keyring'

// 添付キャッシュの上限 (件数)。ノートを消しても URL は本文から消えるだけで
// キャッシュには残るため、放っておくと際限なく太る。古い順に捨てる
const MEDIA_MAX_ENTRIES = 600

// HTML から拾うビルド成果物の URL。Turbopack は `/_next/static/...` の形でも
// (RSC ペイロード内では) `static/chunks/...` の形でも書くので両方受ける。
// 拾いすぎても取得に失敗して捨てるだけなので、緩めに当てる
const ASSET_PATTERN = /(?:\/_next\/)?static\/(?:chunks|css|media)\/[^"'`\s\\)]+/g

// CSS の @font-face が指すフォント。**HTML には現れない**ので、CSS を読んで
// 別に拾う必要がある (拾わないと数式が代替フォントで崩れて出る)。
//
// **url() の中は CSS からの相対パス** (`../media/KaTeX_AMS-Regular.xxx.woff2`)
// なので、文字列の見た目では拾えない。CSS の URL を基準に解決する。
//
// woff2 だけにする。KaTeX は woff2 / woff / ttf の 3 通りを並べており、全部
// 取ると数 MB になるが、woff2 を読めないブラウザはもう Service Worker も
// 使えない (対応時期がほぼ同じ) ので、他は取らない
const CSS_FONT_PATTERN = /url\(\s*['"]?([^'")]+\.woff2)['"]?\s*\)/g

// ビルド成果物ではないが殻に要るもの。ヘッダのアイコンと manifest で、
// 無いとオフラインのヘッダだけ絵が欠けた見た目になる
const SHELL_EXTRAS = ['/icon.svg', '/manifest.webmanifest']

// /offline の HTML に必ず含まれる目印 (page.tsx が同じ文字列を出す)。
// ログイン案内との見分けに使う — あちらも 200 で返るため status では判らない
const OFFLINE_MARKER = 'data-offline-shell'

self.addEventListener('install', () => {
  // 待たずに次の版へ入れ替える。暖機は install ではなくログイン後の warm で
  // 行うので (上の約束 1)、ここですることは無い
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 古い版の殻を片付ける。添付 (MEDIA_CACHE) は版に依らないので残す
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith('qr-shell-') && name !== SHELL_CACHE)
          .map((name) => caches.delete(name)),
      )
      // 既に開いているタブもこの Worker の管理下に入れる。これが無いと
      // 「登録した直後に圏外へ出た」ときだけ何も効かない
      await self.clients.claim()
    })(),
  )
})

// --- 暖機 (ログイン後に register.ts から呼ばれる) ---

// テキストの中に書かれたビルド成果物の URL を集める (相対形は /_next/ を補う)。
function assetUrlsIn(text, pattern) {
  const urls = new Set()
  for (const match of text.matchAll(pattern)) {
    urls.add(match[0].startsWith('/_next/') ? match[0] : `/_next/${match[0]}`)
  }
  return [...urls]
}

// **持っている物は取り直さない**。チャンク名は中身のハッシュを含むので、
// 同じ URL なら中身も同じ。ここを毎回落とすと、暖機はページを開くたびに
// 走るため、殻の分だけ通信が二重になる。
//
// 1 本落ちても投げない。他は使えるし、足りなければ次の暖機で取り直される
async function cacheMissing(cache, urls) {
  await Promise.all(
    urls.map(async (url) => {
      if (await cache.match(url)) {
        return
      }
      try {
        const res = await fetch(url)
        if (res.ok) {
          await cache.put(url, res)
        }
      } catch {
        // 次の暖機で取り直す
      }
    }),
  )
}

// 保存済みの CSS を読んで、そこから参照されているフォントの URL を集める。
// 相対パスは**その CSS の URL を基準に**解決する (上のコメントの理由)。
async function fontUrlsFrom(cache, assets) {
  const urls = new Set()
  for (const url of assets) {
    if (!url.endsWith('.css')) {
      continue
    }
    const res = await cache.match(url)
    if (!res) {
      continue
    }
    const base = new URL(url, self.location.origin)
    for (const match of (await res.text()).matchAll(CSS_FONT_PATTERN)) {
      const resolved = new URL(match[1], base)
      // 他所のホストのフォントは持ち出さない (このアプリには無いが、
      // CSS に外部 URL が混ざったときに黙って外へ取りに行かないように)
      if (resolved.origin === self.location.origin) {
        urls.add(resolved.pathname)
      }
    }
  }
  return [...urls]
}

// /offline の HTML と、そこが指すチャンクを取り直して殻を作り直す。
//
// **HTML を先に検算する**。ログイン案内 (proxy.ts の rewrite) は 200 で返る
// ので status では見分けられない。/offline だけが持つ目印を確かめる。
async function warmShell() {
  const res = await fetch(OFFLINE_PATH, { cache: 'no-store', credentials: 'same-origin' })
  if (!res.ok) {
    throw new Error(`/offline を取得できませんでした (HTTP ${res.status})`)
  }
  const html = await res.text()
  if (!html.includes(OFFLINE_MARKER)) {
    // 目印が無い = 別の画面 (ログイン案内など) が返った。ここで沈めると
    // 圏外で開いたときにログイン画面が出るので、暖機ごと失敗にする
    throw new Error('/offline ではない画面が返りました')
  }

  const cache = await caches.open(SHELL_CACHE)
  // **元の見出しを丸ごとは写さない**。res.text() で本文は復号済みなのに
  // content-encoding: gzip が残ると、ブラウザが平文を gzip として解こうとして
  // 画面が真っ白になる。要るのは content-type だけ
  await cache.put(
    OFFLINE_PATH,
    new Response(html, {
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/html; charset=utf-8' },
    }),
  )

  const assets = assetUrlsIn(html, ASSET_PATTERN)
  await cacheMissing(cache, [...assets, ...SHELL_EXTRAS])
  // フォントは CSS を保存した**後**でないと拾えない (中を読んで探すため)
  const fonts = await fontUrlsFrom(cache, assets)
  await cacheMissing(cache, fonts)

  // 今の版で要らなくなった物を落とす。fetch ハンドラが遅延チャンクを
  // 足すこともあるので、殻の大きさはここでだけ決める
  const keep = new Set([OFFLINE_PATH, ...SHELL_EXTRAS, ...assets, ...fonts])
  for (const request of await cache.keys()) {
    const { pathname, search } = new URL(request.url)
    if (!keep.has(pathname + search)) {
      await cache.delete(request)
    }
  }
  return assets.length + fonts.length
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm') {
    return
  }
  const reply = event.ports?.[0]
  event.waitUntil(
    warmShell().then(
      (count) => reply?.postMessage({ ok: true, assets: count }),
      (error) => reply?.postMessage({ ok: false, error: String(error?.message ?? error) }),
    ),
  )
})

// --- 取得 ---

// 取れなかった行き先を /offline の query に翻訳する。
// /item/4518 → /offline?item=4518、/?q=抵抗 → /offline?q=抵抗
function offlineRedirectUrl(url) {
  const target = new URL(OFFLINE_PATH, url.origin)
  // itemNo に使える文字は [0-9A-Za-z_-] だけ (validation.ts の ITEM_NO_PATTERN)
  // なので**復号しない**。decodeURIComponent を通すと `/item/100%` のような
  // 壊れた URL で URIError が飛び、それが respondWith まで抜けて
  // 「オフライン画面ではなくブラウザのエラー画面」になる。
  // 書式に合わない値は /offline 側が無視する (params.ts)
  const itemMatch = /^\/item\/([^/]+)$/.exec(url.pathname)
  if (itemMatch) {
    target.searchParams.set('item', itemMatch[1])
  }
  const q = url.searchParams.get('q')
  if (q) {
    target.searchParams.set('q', q)
  }
  return target.toString()
}

// 印付きの棚を先に見てから、いつもの棚を見る。
//
// **順番が要点。** 同じ URL が両方にあることは普通に起こる (印を付ける前に
// 眺めていたノート)。印付きの棚は捨てられないので、そちらを先に見れば
// 「見たついで」の棚が上限で削られても圏外の見え方は変わらない。
//
// 印付きの棚へ**書くのはここではない** (画面側の pinCache.ts が突き合わせて
// 出し入れする)。書く側と捨てる側が同じ場所にいないと、印を外したときに
// 消し残る — 期限で腐らせる棚ではないので、消し残りは永久に残る。
async function pinnedFirst(request, cacheName) {
  // **caches.open で開いてから match する。** caches.match({ cacheName }) は
  // その名前の棚がまだ無いと NotFoundError で落ちる仕様で、印を 1 つも
  // 付けていない端末ではそれが常態になる — 落ちれば respondWith ごと失敗し、
  // **オンラインでも画像が割れる**。open は無ければ作るので、その穴が無い
  const pinCache = await caches.open(PIN_CACHE)
  const pinned = await pinCache.match(request)
  if (pinned) {
    return pinned
  }
  return cacheFirst(request, cacheName)
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) {
    return hit
  }
  const res = await fetch(request)
  // 部分応答 (206) は動画のシーク要求。継ぎ接ぎを保存しても再生できないので
  // 素通しする (httpRange.ts が返す形)
  if (res.ok && res.status === 200) {
    await cache.put(request, res.clone())
    await trimCache(cacheName)
  }
  return res
}

// 古い順に捨てて上限に収める。Cache Storage の keys() は入れた順に返る
async function trimCache(cacheName) {
  if (cacheName !== MEDIA_CACHE) {
    return
  }
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (const request of keys.slice(0, keys.length - MEDIA_MAX_ENTRIES)) {
    await cache.delete(request)
  }
}

// 画面の取得。オンラインでは常にサーバを見る (古い HTML を出すより、
// 取れたものを出すほうが一貫する)。取れなければ /offline へ送る
async function handleNavigation(request) {
  const url = new URL(request.url)
  try {
    return await fetch(request)
  } catch {
    if (url.pathname === OFFLINE_PATH) {
      const cached = await caches.match(OFFLINE_PATH, { cacheName: SHELL_CACHE })
      if (cached) {
        return cached
      }
      // 暖機していない = オフラインで出せる物が無い。ブラウザの
      // エラー画面に落とす (中途半端な白紙より、圏外だと判る)
      throw new Error('オフライン用の画面がまだ保存されていません')
    }
    return Response.redirect(offlineRedirectUrl(url), 302)
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 書き込み (Server Action の POST を含む) と他所のホストには触らない。
  // 触ると壊せるものが増えるだけで、オフラインで得られる物は無い
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  // ビルド成果物は中身がハッシュで固定されている = 取り直す意味が無い。
  // 殻に足した物 (アイコン・manifest) も同じ棚から返す — **保存するだけでは
  // 意味がない**。ここを通さないと圏外では素通しになり、取ってあるのに
  // ヘッダの絵だけ欠ける (実際にそうなっていた)
  if (url.pathname.startsWith(STATIC_PREFIX) || SHELL_EXTRAS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE))
    return
  }

  // 添付も名前が UUID で中身が変わらない (回転は新しい名前で保存し直す)。
  // ここを通すことで、先読み (sync.ts) と通常の閲覧が同じ規則で貯まる。
  //
  // **Range 付きは素通しする**。Cache Storage の match は Range を解さず
  // 全体 (200) を返してしまい、動画のシークが壊れる (httpRange.ts が
  // 206 を返す前提でプレイヤーが動いている)
  if (url.pathname.startsWith(MEDIA_PREFIX) && !request.headers.has('Range')) {
    event.respondWith(pinnedFirst(request, MEDIA_CACHE))
    return
  }

  // シークレット断片の暗号文 (docs/65-オフライン対応計画.md §9)。名前は UUID で、
  // 中身が変わるのは編集したときだけ — そのときは画面側が消す
  // (offline/cacheNames.ts の forgetCachedUrl)。
  //
  // **鍵束だけは通さない** (KEYRING_PATH の理由を参照)。
  if (url.pathname.startsWith(SECRET_PREFIX) && url.pathname !== KEYRING_PATH) {
    event.respondWith(pinnedFirst(request, SECRET_CACHE))
    return
  }

  // 残り (API・RSC ペイロードなど) は素通し。同期の口は no-store で、
  // 中間に持たれると別端末の更新が届かなくなる
})
