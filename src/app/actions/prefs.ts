'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isNodeEnvProduction } from '@/lib/appEnv'
import { parsePaneMode, PANE_MODE_COOKIE, PANE_MODE_COOKIE_MAX_AGE } from '@/lib/prefs/paneMode'
import { buildSearchUrl, buildTrashUrl } from '@/lib/search/url'
import { SORT_COOKIE, SORT_COOKIE_MAX_AGE, TRASH_SORT_COOKIE } from '@/lib/prefs/sortMode'
import { parseSort, parseTrashSort } from '@/lib/validation'
import { parseViewMode, VIEW_MODE_COOKIE, VIEW_MODE_COOKIE_MAX_AGE } from '@/lib/prefs/viewMode'

// 見た目の好みを cookie に書くアクション (ペイン構成・表示モード・並び順)。
//
// cookie を書くのでサーバアクションにする。Server Component の描画中は
// Set-Cookie を出せない (next/headers の cookies.md)。フォームの action に
// 置けば、書き換えたあと同じページが描き直されるので、クライアント JS は要らない。
//
// どれも requireUser() を呼ばない。書き換わるのは呼び手自身の
// ブラウザに載る「見た目の好み」(並び順はそれに加えて行き先の URL) だけで、
// DB にも他人にも触れないため。
// (未ログインでも開ける公開ノートの一覧はないが、あっても実害はない)

// 好みの cookie の作法。4 本とも同じで、違うのは寿命だけ。
// secure は呼ぶたびに読む (関数にしてあるのはそのため)
function preferenceCookie(maxAge: number) {
  return {
    // サーバしか読まない (描画前に読めることがこの方式の要)。
    // クライアント JS へ見せる理由がないので閉じておく
    httpOnly: true,
    // HTTPS でだけ送る。ローカル開発は http なので付けない
    // (付けるとローカルで cookie が保存されず、切り替えが効かなくなる)
    secure: isNodeEnvProduction(),
    // 他サイトからの遷移で好みが飛ばない程度に緩く。strict にすると
    // 外部リンクから戻ったときだけ既定に見え、消えたと誤解される
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}

// 検索画面のペイン構成 (3 → 2 → 1) を切り替える (docs/86 §4-4)。
//
// 置き場と作法は表示モード (下の setViewModeAction) と同じ — cookie に持ち、
// サーバが描画前に読む。フォルダーペインを出すかどうかがサーバの判断に
// なるので、クライアントで隠す方式は採らない (出さない構成でもタグの集計を
// 引いてしまう)。requireUser() を呼ばないのも同じ理由 (見た目の好みだけ)。
export async function setPaneModeAction(formData: FormData): Promise<void> {
  const mode = parsePaneMode(formData.get(PANE_MODE_COOKIE))

  const store = await cookies()
  store.set(PANE_MODE_COOKIE, mode, preferenceCookie(PANE_MODE_COOKIE_MAX_AGE))

  // revalidatePath は呼ばない (setViewModeAction と同じ理由)。ただしこの
  // ボタンはヘッダー = どのページにも居るので、検索画面以外から押された
  // ときは「その場のページ」が描き直されるだけで一覧には効かない。
  // 効くのは次に検索画面を開いたときで、cookie は既に新しい
}

// 検索結果の表示モード (小/大) を切り替える (docs/23-検索結果表示モード計画.md §5)。
export async function setViewModeAction(formData: FormData): Promise<void> {
  const mode = parseViewMode(formData.get(VIEW_MODE_COOKIE))

  const store = await cookies()
  store.set(VIEW_MODE_COOKIE, mode, preferenceCookie(VIEW_MODE_COOKIE_MAX_AGE))

  // **revalidatePath は呼ばない。**
  //
  // 一度 revalidatePath('/', 'layout') を置いていたが、これは `/` 配下の
  // *全ルート* を無効にする。静的な /manifest.webmanifest まで再生成対象になり、
  // Next がその prerender キャッシュを書き直そうとする。ところがコンテナは
  // node ユーザーで動くのに .next は root 所有 (Dockerfile の COPY) なので
  // 書けず、切り替えるたびにサーバログへ警告が出た。
  //
  //   Failed to update prerender cache for /manifest.webmanifest
  //   EACCES: permission denied, open '/app/.next/server/app/manifest.webmanifest.body'
  //
  // そもそも不要だった。一覧は force-dynamic でサーバ側にキャッシュが無く、
  // フォームの action から呼ばれたサーバアクションは、その場のページを
  // Next が描き直す (Router Cache も一緒に更新される)。
}

// 一覧の並び順を切り替える (docs/11-アプリ的UIUX計画.md §3、src/lib/prefs/sortMode.ts)。
//
// **cookie に覚えつつ、URL も更新する**のがこのアクションの役目。
// 表示モード (setViewModeAction) と違って遷移まで行うのは、並び順が
// ページ送りと戻り先にも効く「いま何を見ているか」でもあるため。
//
// cookie だけにすると共有リンクで並びを指定できず、URL だけにすると
// `?sort=` を持たない入口 (ヘッダーのホーム・検索フォーム・スキャン・
// タグリンク) から入るたびに既定へ戻る。両方を書くのが答え。
export async function setSortAction(formData: FormData): Promise<void> {
  const sort = parseSort(formData.get(SORT_COOKIE))
  // 検索語は持ち回す。並び替えただけで検索語が消えては困る
  const query = String(formData.get('q') ?? '')

  const store = await cookies()
  store.set(SORT_COOKIE, sort, preferenceCookie(SORT_COOKIE_MAX_AGE))

  // 並びを変えたら 1 ページ目から見せる (buildSearchUrl と同じ約束)。
  // redirect で URL にも載せるので、ページ送り・戻り先がその並びを引き継ぐ
  redirect(buildSearchUrl(query, 1, sort))
}

// ゴミ箱の並び順を切り替える (docs/67-ゴミ箱表示形式計画.md §2)。
//
// setSortAction と同じ形 (cookie に覚えてから URL へ redirect) だが、cookie は
// 別 (TRASH_SORT_COOKIE) で、持ち回す検索語も無い。分ける理由は prefs/sortMode.ts。
export async function setTrashSortAction(formData: FormData): Promise<void> {
  const sort = parseTrashSort(formData.get(TRASH_SORT_COOKIE))

  const store = await cookies()
  store.set(TRASH_SORT_COOKIE, sort, preferenceCookie(SORT_COOKIE_MAX_AGE))

  redirect(buildTrashUrl(sort))
}
