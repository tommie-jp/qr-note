// Service Worker の登録と暖機の呼び出し (docs/65-オフライン対応計画.md §5)。
//
// **登録の URL に版を混ぜる**のが要点。public/sw.js は静的ファイルなので中身が
// 変わらないリリースもあるが、ブラウザは「スクリプトの中身が変わったか」で
// 更新を判断する。?v=<アプリの版> を付けておけば、リリースごとに別の URL =
// 必ず入れ替わる。sw.js 側はこの値をキャッシュ名に使う (古い殻の掃除)。
//
// 登録も暖機も**失敗を握り潰さない**。ただし画面は止めない — オフラインで
// 使えないだけで、オンラインの機能は何一つ変わらないため。

const SW_PATH = '/sw.js'

// 暖機の返事を待つ上限。Worker が黙ったまま返さないと、呼び出し側の
// 「準備中」がいつまでも終わらない
const WARM_TIMEOUT_MS = 30_000

export function isServiceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

// **開発サーバでは Service Worker を動かさない。**
//
// このアプリのキャッシュは「/_next/static/ は中身がハッシュで固定されている
// から取り直さなくてよい」を前提にしている。ところが `next dev` (Turbopack) の
// チャンク名は編集しても変わらないので、その前提が崩れて**古い JS を返し続ける**
// — 直したはずのコードが反映されない、という追いにくい壊れ方になる
// (実際にこの実装中に踏んだ)。
//
// 消すだけでなく登録も解いて殻も捨てる。一度でも本番相当を localhost で開くと
// Worker が残り、そのあと dev に戻った人が同じ罠にはまるため。
async function unregisterInDev(): Promise<void> {
  for (const registration of await navigator.serviceWorker.getRegistrations()) {
    await registration.unregister()
  }
  for (const name of await caches.keys()) {
    if (name.startsWith('qr-shell-')) {
      await caches.delete(name)
    }
  }
}

// 版付きの URL で登録する。既に同じ URL で登録済みならブラウザが何もしない。
// 開発サーバでは代わりに登録を解く (unregisterInDev の理由を参照)。
export async function registerOfflineWorker(
  version: string,
): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) {
    return null
  }
  if (process.env.NODE_ENV === 'development') {
    await unregisterInDev()
    return null
  }
  // updateViaCache: 'none' … sw.js 自体をブラウザの HTTP キャッシュから
  // 読ませない。版を上げたのに古い Worker が居座る事故を防ぐ
  const registration = await navigator.serviceWorker.register(
    `${SW_PATH}?v=${encodeURIComponent(version)}`,
    { scope: '/', updateViaCache: 'none' },
  )
  await waitForActivation(registration)
  return registration
}

// 入れ替え中の Worker が動き出すまで待つ。
//
// **待たないと、リリース直後の 1 回だけ暖機が古い Worker に届く。** 古い方は
// 古い版のキャッシュ名 (qr-shell-<前の版>) へ書き、それは新しい方が activate
// した瞬間に掃除される — つまり暖機がまるごと無駄になり、新しい殻は次に
// アプリを開くまで空のままになる。圏外へ出るのがその間なら、オフラインが死ぬ。
//
// navigator.serviceWorker.ready では足りない。あちらは「有効な登録がある」で
// 解決するので、入れ替え前の古い active を返してくる。
async function waitForActivation(registration: ServiceWorkerRegistration): Promise<void> {
  const pending = registration.installing ?? registration.waiting
  if (pending === null) {
    return
  }
  await new Promise<void>((resolve) => {
    const check = () => {
      // redundant … 入れ替えに失敗した (別の Worker に負けた)。待ち続けても
      // 状態は動かないので、諦めて先へ進む (暖機は失敗として扱われる)
      if (pending.state === 'activated' || pending.state === 'redundant') {
        pending.removeEventListener('statechange', check)
        resolve()
      }
    }
    pending.addEventListener('statechange', check)
    check()
  })
}

export interface WarmResult {
  ok: boolean
  assets?: number
  error?: string
}

// /offline の殻を保存させる。**ログイン済みの画面から呼ぶこと** —
// 未ログインだと proxy.ts がログイン案内を 200 で返し、sw.js 側の目印検査で
// 弾かれて失敗になる (弾く理由は sw.js の warmShell を参照)。
export async function warmOfflineShell(): Promise<WarmResult> {
  if (!isServiceWorkerSupported()) {
    return { ok: false, error: 'この端末では Service Worker を使えません' }
  }
  if (process.env.NODE_ENV === 'development') {
    // 登録を解いてあるので navigator.serviceWorker.ready は永遠に解決しない。
    // 待たずに断る (開発では本文の同期だけが動く)
    return { ok: false, error: '開発サーバではオフライン用の保存を行いません' }
  }
  // ready … activate 済みの登録を待つ。register 直後は active がまだ null で、
  // そこへ postMessage しても誰も受け取らない
  const registration = await navigator.serviceWorker.ready
  const worker = registration.active
  if (worker === null) {
    return { ok: false, error: 'Service Worker がまだ動いていません' }
  }

  return new Promise<WarmResult>((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(
      () => resolve({ ok: false, error: 'オフライン用の保存が時間内に終わりませんでした' }),
      WARM_TIMEOUT_MS,
    )
    channel.port1.onmessage = (event: MessageEvent<WarmResult>) => {
      clearTimeout(timer)
      resolve(event.data)
    }
    worker.postMessage({ type: 'warm' }, [channel.port2])
  })
}
