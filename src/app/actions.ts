'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { isDemoMode } from '@/lib/appEnv'
import { parseBulkTagForm } from '@/lib/bulkTags'
import { renderCircuits } from '@/lib/circuitCache'
import { isValidCommitOid } from '@/lib/git/notePath'
import {
  commitNote,
  noteAtCommit,
  noteHistory,
  removeNotes,
} from '@/lib/git/notesRepo'
import { recordMeasurement } from '@/lib/healthEdit'
import { backfillAllNotes } from '@/lib/noteHistoryBackfill'
import {
  emptyTrash,
  getItem,
  purgeItems,
  recordItemAccess,
  restoreItems,
  setItemOfflinePin,
  setItemPublic,
  trashItems,
  upsertItem,
  upsertMemo,
} from '@/lib/items'
import { parseBackUrl, parseSelectedItemNos } from '@/lib/itemSelection'
import { buildSearchUrl, buildTrashUrl } from '@/lib/searchUrl'
import {
  SORT_COOKIE,
  SORT_COOKIE_MAX_AGE,
  TRASH_SORT_COOKIE,
} from '@/lib/sortMode'
import { currentUser, requireUser } from '@/lib/session'
import { addTagsToMemo, removeTagsFromMemo } from '@/lib/tagEdit'
import { toggleTaskLine } from '@/lib/taskCheckbox'
import {
  isValidItemNo,
  MAX_TEXT_LENGTH,
  parseMode,
  parseSort,
  parseTrashSort,
} from '@/lib/validation'
import {
  parseViewMode,
  VIEW_MODE_COOKIE,
  VIEW_MODE_COOKIE_MAX_AGE,
} from '@/lib/viewMode'

function readText(formData: FormData, key: string): string {
  const value = formData.get(key)
  if (typeof value !== 'string') {
    return ''
  }
  if (value.length > MAX_TEXT_LENGTH) {
    throw new Error(`${key} が長すぎます (最大 ${MAX_TEXT_LENGTH} 文字)`)
  }
  return value
}

function readItemNo(formData: FormData): string {
  const itemNo = String(formData.get('itemNo') ?? '')
  if (!isValidItemNo(itemNo)) {
    throw new Error('itemNo が不正です')
  }
  return itemNo
}

// 保存後の「保存しました」トースト用の戻り先 (docs/11-アプリ的UIUX計画.md §2-3)。
// 値を時刻にするのは、連続保存でも毎回トーストを出すため (SavedToast の key に
// 使う)。印はトーストを出した直後にクライアントが URL から消す
function savedHref(itemNo: string): string {
  return `/item/${itemNo}?saved=${Date.now()}`
}

// Server Action は「画面に置いたボタン」ではなく、誰でも叩ける POST の口
// (id さえ判れば画面を通さず呼べる)。proxy.ts も未ログインの POST は 401 に
// するが、それは楽観的な検査でしかないので、書き込む側でも必ず確かめる
// (docs/18-ログイン計画.md)。

// Ver1 の /item/:itemNo POST 相当: memo だけをその場で更新 (未登録なら作成)
export async function updateMemoAction(formData: FormData): Promise<void> {
  await requireUser()
  const itemNo = readItemNo(formData)
  const memo = readText(formData, 'memo')
  await upsertMemo(itemNo, memo)
  revalidatePath(`/item/${itemNo}`)
  redirect(savedHref(itemNo))
}

// 閲覧画面 (markdown タブ) でタスクリストのチェックを切り替える
// (docs/55-チェックボックス操作計画.md §4)。
//
// フォームではなくクライアントから直接呼ぶので FormData ではなく引数で受ける。
// 送るのは**望む状態** (checked) であって「裏返せ」ではない — 連打や二重送信で
// 意図と逆に倒れないようにするため (setItemPublicAction と同じ約束)。
//
// 行番号は画面が描かれた時点のものなので、本文が変わっていれば古い。
// toggleTaskLine がその行を「本当にタスク項目か」で検算し、違えば書き換えずに
// 投げる (クライアントは楽観更新を巻き戻してエラーを出す)。
export async function toggleMemoTaskAction(
  itemNo: string,
  line: number,
  checked: boolean,
): Promise<void> {
  await requireUser()
  if (!isValidItemNo(itemNo)) {
    throw new Error('itemNo が不正です')
  }
  const item = await getItem(itemNo)
  if (item === null) {
    throw new Error('ノートが見つかりません')
  }
  const next = toggleTaskLine(item.memo, line, checked)
  if (next === null) {
    throw new Error('本文が変わっています。画面を更新してください')
  }
  // 既に望む状態なら書かない (updated_at を動かさない)
  if (next !== item.memo) {
    await upsertMemo(itemNo, next)
  }
  // これで Next.js が同じ応答の中でこのルートを描き直す (server-actions.md)。
  // 画像回転と違い router.refresh() は要らない。
  //
  // 1 回押すごとに ItemView 全体の再描画 (renderCircuits 込み) を払うことは
  // 承知のうえ。テキストタブと**まだ開いていない編集タブ**は本文をサーバ描画
  // から受け取るので、ここを省くと押した結果が反映されない画面が残る。
  // まとめ送りにしないのは、押した分だけ即保存されるほうが単語帳向きなため
  revalidatePath(`/item/${itemNo}`)
  // 一覧も無効にする。チェックは検索条件そのもの (is:todo。docs/56) なので、
  // 押した語が `#英単語 is:todo` の一覧に残っていては単語帳の回転が壊れる。
  //
  // **Next の「他のページも次に開いたとき更新される」挙動には頼らない** —
  // revalidatePath.md が明示的に一時的な仕様だと書いており、将来
  // 指定パスだけに絞られると、戻ったときに古い一覧が出る。
  // 他のノート更新系アクション (trash/restore/bulkTag) と同じ書き方に揃える
  revalidatePath('/')
}

// 閲覧画面の記録欄から健康記録を 1 つ書き込む
// (docs/83-健康管理フェンス計画.md §7)。
//
// toggleMemoTaskAction と同じ形 — フォームではなくクライアントから直接呼び、
// 「どう変えるか」ではなく**書き込む値そのもの**を受け取る (連打や二重送信で
// 意図とずれない)。書き込む先はこのフェンスを持つノート自身で、当月ノートを
// 探して無ければ作る、といった仕掛けは持たない (計画 §7)。
//
// 値の検めは recordMeasurement (純関数) が持つ。**書いた行を自分で読み直せる
// かどうか**が唯一の合格条件で、読めない値なら本文を触らずに投げ返す。
export async function recordHealthAction(
  itemNo: string,
  date: string,
  item: string,
  value: number,
  unit: string,
): Promise<void> {
  await requireUser()
  if (!isValidItemNo(itemNo)) {
    throw new Error('itemNo が不正です')
  }
  // 誰でも叩ける POST の口なので、型も自分で確かめる (画面を通さず呼べる)
  if (
    typeof date !== 'string' ||
    typeof item !== 'string' ||
    typeof unit !== 'string' ||
    typeof value !== 'number'
  ) {
    throw new Error('記録の値が不正です')
  }
  const existing = await getItem(itemNo)
  if (existing === null) {
    throw new Error('ノートが見つかりません')
  }
  const next = recordMeasurement(existing.memo, { date, item, value, unit })
  if (next === null) {
    throw new Error('この値は記録できません')
  }
  // 既に同じ値なら書かない (updated_at を動かさない)
  if (next !== existing.memo) {
    await upsertMemo(itemNo, next)
  }
  revalidatePath(`/item/${itemNo}`)
  // 一覧も無効にする。記録は本文そのものなので、一覧のプレビューや
  // 検索結果が古いままになる (toggleMemoTaskAction と同じ判断)
  revalidatePath('/')
}

// Ver1 の /edit/:itemNo POST 相当: mode / memo / url を更新 (未登録なら作成)
export async function updateItemAction(formData: FormData): Promise<void> {
  await requireUser()
  const itemNo = readItemNo(formData)
  const memo = readText(formData, 'memo')
  const url = readText(formData, 'url')
  const mode = parseMode(formData.get('mode'))
  await upsertItem(itemNo, { memo, url, mode })
  revalidatePath(`/item/${itemNo}`)
  redirect(savedHref(itemNo))
}

// --- 公開 (docs/22-ノート公開計画.md) ---

// ノートを公開する / 公開をやめる。
//
// フォームは**望む状態** (public=1 / 0) を送る。「いまの状態を裏返す」に
// すると、二重送信や戻るボタンで意図と逆に倒れる (docs/22 §7)。
//
// requireUser() は飾りではない。これは誰でも叩ける POST の口で、
// もし通れば「他人が自分のノートを勝手に公開できる」ことになる。
// proxy.ts も未ログインの POST は 401 にするが、それは楽観的な検査でしかない。
export async function setItemPublicAction(formData: FormData): Promise<void> {
  await requireUser()
  // デモインスタンスでは公開機能そのものを無効にする (docs/38-デモモード計画.md §3)。
  // UI ではトグルを出さない (ItemView) が、Server Action は画面を通さず id さえ
  // 判れば叩ける口なので、ここでも塞ぐ。isPublicItem() 側でも公開を認めないので
  // 二重の防御になる (万一 public_at が立っても未ログインには見えない)。
  if (isDemoMode()) {
    throw new Error('デモモードでは公開機能は使えません')
  }
  const itemNo = readItemNo(formData)
  // '1' だけを公開と読む。判らない値は非公開へ倒す (既定を閉じる側へ)
  const isPublic = formData.get('public') === '1'
  await setItemPublic(itemNo, isPublic)
  revalidatePath(`/item/${itemNo}`)
}

// --- オフラインの印 (docs/65-オフライン対応計画.md §7) ---

// ノートを「オフラインで常に使う」対象にする / やめる。
//
// 公開トグルと同じく**望む状態** (pin=1 / 0) を送る形にする。裏返す形だと
// 二重送信で意図と逆に倒れる。
//
// 印を立てるときに**回路図を描いておく**のがこの口の要点。同期
// (syncItems.ts) は出来上がっている図を配るだけで描かないので、ここで
// 描かないと「印を付けたのに圏外で図だけ出ない」になる。ノートを一度でも
// 開いていれば ItemView が描き済みだが、それに頼ると「開かずに印だけ付けた」
// 経路が漏れる。
//
// 描画の失敗でトグルを止めない。TeX のエラーは本文側の問題で、印を付ける
// 操作とは別の話 (図はオンラインで開けばエラーとして見える)。
export async function setItemOfflinePinAction(formData: FormData): Promise<void> {
  await requireUser()
  // デモでは同期の口ごと閉じてある (api/sync/items) ので、印を立てても何も
  // 起きない。**旗の欠落に頼らず口も閉じる** — UI で出さないことと、叩けない
  // ことは別の話 (setItemPublicAction と同じ流儀)。共有アカウントのデモで
  // 誰かが印を立てると、他の人の画面にもその帯が出てしまう
  if (isDemoMode()) {
    throw new Error('デモモードではオフライン保存は使えません')
  }
  const itemNo = readItemNo(formData)
  // '1' だけを印ありと読む。判らない値は印なしへ倒す (通信量を使わない側へ)
  const pinned = formData.get('pin') === '1'
  await setItemOfflinePin(itemNo, pinned)

  if (pinned) {
    const item = await getItem(itemNo)
    if (item !== null) {
      try {
        await renderCircuits(item.memo)
      } catch (error) {
        console.warn(`オフライン用の回路図を描けませんでした (${itemNo})`, error)
      }
    }
  }

  revalidatePath(`/item/${itemNo}`)
}

// 検索結果で選択したノートにまとめて印を立てる (docs/65 §7)。
// 一括タグ・ゴミ箱と同じフォームから formAction で分岐して呼ばれる。
//
// **立てるだけで、外す口はここに作らない。** 一括で外せると、全選択して
// 押した瞬間に端末の持ち出しが丸ごと消える — 消えたことは圏外へ出るまで
// 判らない。外すのは 1 件ずつ (ノート画面のトグル) で足りる。
//
// 回路図は 1 件ずつと同じく**ここで描いておく** (§7-2)。選んだ数だけ TeX が
// 走るので遅くなりうるが、描かずに印だけ立てると「圏外で図だけ出ない」が
// 選んだ件数ぶん一度に生まれる。描画の失敗で操作は止めない。
export async function setItemsOfflinePinAction(formData: FormData): Promise<void> {
  await requireUser()
  // 単体のトグルと同じ理由でデモを塞ぐ (旗の欠落に頼らない)
  if (isDemoMode()) {
    throw new Error('デモモードではオフライン保存は使えません')
  }
  const itemNos = parseSelectedItemNos(formData)
  const back = parseBackUrl(formData)

  for (const itemNo of itemNos) {
    await setItemOfflinePin(itemNo, true)
    const item = await getItem(itemNo)
    if (item === null) {
      continue
    }
    try {
      await renderCircuits(item.memo)
    } catch (error) {
      console.warn(`オフライン用の回路図を描けませんでした (${itemNo})`, error)
    }
  }

  if (itemNos.length > 0) {
    // 一覧も描き直す。印は一覧に出ないが、**次の同期で持ち出す対象が
    // 変わった**ので、キャッシュされた古い応答を残さない
    revalidatePath('/')
  }

  redirect(back)
}

// --- ゴミ箱 (二段階削除。docs/12-ゴミ箱計画.md) ---

// 検索結果で選択したノートをゴミ箱へ入れる (復元できるので confirm は出さない)。
// 一括タグと同じフォームから formAction で分岐して呼ばれる。
export async function trashItemsAction(formData: FormData): Promise<void> {
  await requireUser()
  const itemNos = parseSelectedItemNos(formData)
  const back = parseBackUrl(formData)

  if (itemNos.length > 0) {
    await trashItems(itemNos)
    revalidatePath('/')
    revalidatePath('/trash')
  }

  redirect(back)
}

// ゴミ箱から戻す。/trash の「復元」と /item のバナーの両方から呼ばれ、
// どちらも同じルートを revalidate すれば呼び出し元がそのまま描き直される
// (Next.js は revalidatePath で現在のルートを再レンダリングして返す)。
export async function restoreItemsAction(formData: FormData): Promise<void> {
  await requireUser()
  const itemNos = parseSelectedItemNos(formData)
  if (itemNos.length === 0) {
    return
  }

  await restoreItems(itemNos)
  revalidatePath('/')
  revalidatePath('/trash')
  for (const itemNo of itemNos) {
    revalidatePath(`/item/${itemNo}`)
  }
}

// 永久削除。ゴミ箱にある行しか消せないことは items.ts の purgeItems が保証する
// (UI の confirm は最後の一押しで、防護そのものではない)。
export async function purgeItemsAction(formData: FormData): Promise<void> {
  await requireUser()
  const itemNos = parseSelectedItemNos(formData)
  if (itemNos.length === 0) {
    return
  }

  const purged = await purgeItems(itemNos)
  await tombstoneNotes(purged)
  revalidatePath('/')
  revalidatePath('/trash')
}

export async function emptyTrashAction(): Promise<void> {
  await requireUser()
  const purged = await emptyTrash()
  await tombstoneNotes(purged)
  revalidatePath('/')
  revalidatePath('/trash')
}

// 永久削除を git 履歴にも「この版で消えた」として刻む墓石コミット
// (docs/57-ノートgit履歴計画.md §4)。対象は purgeItems / emptyTrash が返す
// **実際に消えた itemNo だけ** (消えなかったノートの履歴に墓石を立てない)。
//
// 失敗しても投げない。DB の削除はもう終わっていて、git の都合で削除操作を
// エラーにする理由がない (履歴にファイルが残るだけで無害。次に同じ番号を
// 使って永久削除すればそのとき消える)。ただし黙らせはせずログには残す。
async function tombstoneNotes(itemNos: string[]): Promise<void> {
  if (itemNos.length === 0 || isDemoMode()) {
    return
  }
  const message =
    itemNos.length === 1 ? `delete ${itemNos[0]}` : `delete ${itemNos.length} notes`
  try {
    await removeNotes(itemNos, message)
  } catch (error) {
    console.error(`git 履歴の墓石コミットに失敗しました (${itemNos.join(', ')}):`, error)
  }
}

// 検索結果の表示モード (小/大) を切り替える (docs/23-検索結果表示モード計画.md §5)。
//
// cookie を書くのでサーバアクションにする。Server Component の描画中は
// Set-Cookie を出せない (next/headers の cookies.md)。フォームの action に
// 置けば、書き換えたあと同じページが描き直されるので、クライアント JS は要らない。
//
// 他のアクションと違い requireUser() を呼ばない。書き換わるのは呼び手自身の
// ブラウザに載る「見た目の好み」だけで、DB にも他人にも触れないため。
// (未ログインでも開ける公開ノートの一覧はないが、あっても実害はない)
export async function setViewModeAction(formData: FormData): Promise<void> {
  const mode = parseViewMode(formData.get(VIEW_MODE_COOKIE))

  const store = await cookies()
  store.set(VIEW_MODE_COOKIE, mode, {
    // サーバしか読まない (描画前に読めることがこの方式の要)。
    // クライアント JS へ見せる理由がないので閉じておく
    httpOnly: true,
    // HTTPS でだけ送る。ローカル開発は http なので付けない
    // (付けるとローカルで cookie が保存されず、切り替えが効かなくなる)
    secure: process.env.NODE_ENV === 'production',
    // 他サイトからの遷移で好みが飛ばない程度に緩く。strict にすると
    // 外部リンクから戻ったときだけ既定に見え、消えたと誤解される
    sameSite: 'lax',
    path: '/',
    maxAge: VIEW_MODE_COOKIE_MAX_AGE,
  })

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

// 検索結果で選択した複数ノートへ、タグをまとめて追加/削除する。
// タグの正本はメモ本文なので、本文を書き換えて upsertMemo で保存し
// items.tags を再計算させる (tagEdit.ts 参照)。実際に本文が変わったノートだけ
// 保存するので、文章中にしかないタグの削除など「効かない」操作では更新しない。
export async function bulkTagAction(formData: FormData): Promise<void> {
  await requireUser()
  const { mode, itemNos, tags, back } = parseBulkTagForm(formData)

  if (itemNos.length > 0 && tags.length > 0) {
    for (const itemNo of itemNos) {
      const item = await getItem(itemNo)
      const memo = item?.memo ?? ''
      const next =
        mode === 'add'
          ? addTagsToMemo(memo, tags)
          : removeTagsFromMemo(memo, tags)
      if (next !== memo) {
        await upsertMemo(itemNo, next)
      }
    }
    revalidatePath('/')
  }

  redirect(back)
}

// ノートを開いたことを記録する (docs/37-アクセス順計画.md)。
//
// **画面の描画時ではなくクライアントのマウント後に呼ぶ** (RecordAccess.tsx)。
// サーバ側の描画で記録すると、一覧の <Link> を Next.js が先読み (prefetch)
// しただけで「見た」ことになり、検索結果に並んだ全ノートがアクセス順の
// 先頭に来てしまう。prefetch はクライアント効果を実行しないので、
// マウント後に呼べば誤発火しない。
//
// Server Action は誰でも叩ける POST の口なので、ここでもログインを確かめる
// (未ログインの閲覧で並びを書き換えられないように。/item は公開ノートを
// 未ログインへ見せる口でもある)。
//
// 失敗しても投げない。並びが 1 回進まないだけで、ノートの表示を巻き添えに
// する理由がない。ただし黙らせはせずログには残す。
export async function recordAccessAction(itemNo: string): Promise<void> {
  // requireUser() ではなく currentUser() で見るのが要点。**これは利用者が
  // 頼んだ操作ではなく、画面を開いた副作用**なので、未ログインなら黙って
  // 何もしないのが正しい。requireUser() は投げるため、公開ノートを未ログインで
  // 開いた人に不要なエラーを見せることになる (書き込ませない目的は同じく達する)
  if ((await currentUser()) === null) {
    return
  }
  if (!isValidItemNo(itemNo)) {
    return
  }
  try {
    await recordItemAccess(itemNo)
  } catch (error) {
    console.error(`アクセス日時を記録できませんでした (${itemNo}):`, error)
  }
}

// 一覧の並び順を切り替える (docs/11-アプリ的UIUX計画.md §3、src/lib/sortMode.ts)。
//
// **cookie に覚えつつ、URL も更新する**のがこのアクションの役目。
// 表示モード (setViewModeAction) と違って遷移まで行うのは、並び順が
// ページ送りと戻り先にも効く「いま何を見ているか」でもあるため。
//
// cookie だけにすると共有リンクで並びを指定できず、URL だけにすると
// `?sort=` を持たない入口 (ヘッダーのホーム・検索フォーム・スキャン・
// タグリンク) から入るたびに既定へ戻る。両方を書くのが答え。
//
// requireUser() は呼ばない。書き換わるのは呼び手自身のブラウザに載る
// 「見た目の好み」と行き先の URL だけで、DB にも他人にも触れない
// (setViewModeAction と同じ判断)。
export async function setSortAction(formData: FormData): Promise<void> {
  const sort = parseSort(formData.get(SORT_COOKIE))
  // 検索語は持ち回す。並び替えただけで検索語が消えては困る
  const query = String(formData.get('q') ?? '')

  const store = await cookies()
  store.set(SORT_COOKIE, sort, {
    // サーバしか読まない (描画前に読めることがこの方式の要)
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // 他サイトからの遷移で好みが飛ばない程度に緩く
    sameSite: 'lax',
    path: '/',
    maxAge: SORT_COOKIE_MAX_AGE,
  })

  // 並びを変えたら 1 ページ目から見せる (buildSearchUrl と同じ約束)。
  // redirect で URL にも載せるので、ページ送り・戻り先がその並びを引き継ぐ
  redirect(buildSearchUrl(query, 1, sort))
}

// ゴミ箱の並び順を切り替える (docs/67-ゴミ箱表示形式計画.md §2)。
//
// setSortAction と同じ形 (cookie に覚えてから URL へ redirect) だが、cookie は
// 別 (TRASH_SORT_COOKIE) で、持ち回す検索語も無い。分ける理由は sortMode.ts。
export async function setTrashSortAction(formData: FormData): Promise<void> {
  const sort = parseTrashSort(formData.get(TRASH_SORT_COOKIE))

  const store = await cookies()
  store.set(TRASH_SORT_COOKIE, sort, {
    // サーバしか読まない (描画前に読めることがこの方式の要)
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // 他サイトからの遷移で好みが飛ばない程度に緩く
    sameSite: 'lax',
    path: '/',
    maxAge: SORT_COOKIE_MAX_AGE,
  })

  redirect(buildTrashUrl(sort))
}

// --- git 履歴 (docs/57-ノートgit履歴計画.md) ---

// デモモードでは履歴機能を丸ごと閉じる (docs/57 §4)。毎時再シードで履歴が
// 嘘になるうえ、ゲストの書き込みで履歴が溜まる一方になる。UI はリンクごと
// 出さないが、Server Action は画面を通さず叩ける口なのでここでも塞ぐ
// (setItemPublicAction と同じ二重防御)。
function assertHistoryEnabled(): void {
  if (isDemoMode()) {
    throw new Error('デモモードでは履歴機能は使えません')
  }
}

// いまの本文を 1 版としてコミットする。
//
// **本文はフォームから受けず、DB のいまの memo をコミットする**のが要点。
// 編集画面は自動保存込みで DB が常に最新であり、画面由来の本文を受けると
// 「保存していない本文がコミットだけされる」というねじれが作れてしまう。
export async function commitNoteAction(formData: FormData): Promise<void> {
  await requireUser()
  assertHistoryEnabled()
  const itemNo = readItemNo(formData)
  // メッセージは 1 行目だけ使う (git の subject。履歴一覧に出るのはここ)。
  // 制御文字も除く — アプリ内表示は React が守るが、bundle を手元の端末で
  // `git log` したときの表示崩れ/エスケープ注入をここで断つ。
  // 未入力は既定文言 — 空メッセージでコミットを止めるほどの操作ではない
  const message =
    readText(formData, 'message')
      .split('\n')[0]
      ?.replace(/[\x00-\x1f\x7f]/g, '')
      .trim() || `update ${itemNo}`

  const item = await getItem(itemNo)
  if (item === null) {
    throw new Error('ノートが見つかりません')
  }
  const oid = await commitNote(itemNo, item.memo, message)
  revalidatePath(`/item/${itemNo}/history`)
  // 「コミットした」と「変化なし (null)」を画面で見分けられるようにする
  // (backfillHistoryAction と同じ ?done= の流儀)。変化なしは、画面の描画と
  // 送信の間に別タブが同じ内容を先にコミットしたときに起こる — その場合
  // 入力したメッセージは使われないので、成功と同じ顔をさせない
  redirect(
    `/item/${itemNo}/history?done=${oid === null ? 'noop' : 'committed'}`,
  )
}

// 過去の版の本文へ戻す。
//
// git 側は触らず、**既存の保存経路 (upsertMemo) で DB だけを書き換える** —
// tags / props / taskTodo の派生キャッシュを再計算させるため (docs/57 §4)。
// 結果は「未コミットの変更がある」状態になり、気に入らなければコミットせずに
// 直せるし、確定なら次のコミットが「復元した」という 1 版になる。
// 永久削除済みのノートも upsert なので蘇る (履歴からの回収口)。
export async function restoreNoteVersionAction(formData: FormData): Promise<void> {
  await requireUser()
  assertHistoryEnabled()
  const itemNo = readItemNo(formData)
  const oid = String(formData.get('oid') ?? '')
  if (!isValidCommitOid(oid)) {
    throw new Error('コミット oid が不正です')
  }
  // このノートの履歴に載っている oid だけを受ける ([oid]/page.tsx と同じ約束)。
  // showNote はパスを notes/<itemNo>.md に固定するので他ノートの本文は
  // 漏れないが、履歴と無関係なコミットからの「復元」を意味として許さない
  const history = await noteHistory(itemNo)
  if (!history.some((commit) => commit.oid === oid)) {
    throw new Error('このノートの履歴にないコミットです')
  }

  const memo = await noteAtCommit(itemNo, oid)
  if (memo === null) {
    throw new Error('この版にノートの本文がありません')
  }
  await upsertMemo(itemNo, memo)
  revalidatePath(`/item/${itemNo}`)
  redirect(savedHref(itemNo))
}

// 既存ノートの一括取り込み (docs/57 §6)。設定ページ (/settings/history) の
// ボタンから。冪等なので二重送信されても余分なコミットは増えない。
export async function backfillHistoryAction(): Promise<void> {
  await requireUser()
  assertHistoryEnabled()
  const { oid } = await backfillAllNotes()
  redirect(`/settings/history?done=${oid === null ? 'noop' : 'imported'}`)
}
