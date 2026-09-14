'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { conflictState, readBase, readItemNo, readText } from '@/lib/actionForm'
import { renderCircuits } from '@/lib/circuitCache'
import { recordMeasurement } from '@/lib/healthEdit'
import { MAX_MEASURE_VALUES } from '@/lib/healthRecords'
import { getItem } from '@/lib/items/read'
import { modifyMemo, saveItemIfUnchanged } from '@/lib/items/write'
import { recordItemAccess } from '@/lib/items/flags'
import type { SaveState } from '@/lib/saveState'
import { currentUser, requireUser } from '@/lib/auth/session'
import { differsOnlyInTaskMarks, toggleTaskLine } from '@/lib/markdown/taskCheckbox'
import { isValidItemNo, MAX_TEXT_LENGTH, parseMode } from '@/lib/validation'
import { revalidateItem } from './_revalidate'
import { checkpointBeforeOverwrite, savedHref } from './_save'

// ノートの本文を書くアクション (保存・チェック・健康記録) と、開いた記録。

// 保存したノートの回路図を**応答を返した後に**描いておく
// (docs/85-回路図表示待ち計画.md §4)。
//
// 図の描画は 1 枚 1〜3 秒かかり、結果は DB に溜まる (circuit_svgs)。
// 描かずに終わると「保存 → 表示」の**表示のほうが**その分待たされる —
// 書いた本人がいちばん先に開く画面なので、待ちはそこに出る。
//
// after() なので保存の応答は待たせない (redirect の後でも走る)。
// この直後の表示 (planCircuits) と同じ図を二重に描かないよう、
// getOrRenderCircuit が進行中の描画を共有する。
//
// 失敗しても保存は成功のまま — 図はキャッシュ (派生データ) でしかなく、
// TeX の書き間違いで本文が保存できなくなるほうがずっと困る
function warmCircuitsAfterResponse(itemNo: string, memo: string): void {
  after(async () => {
    try {
      await renderCircuits(memo)
    } catch (error) {
      console.warn(`保存後の回路図を描けませんでした (${itemNo})`, error)
    }
  })
}

// Ver1 の /item/:itemNo POST 相当: memo だけをその場で更新 (未登録なら作成)。
//
// **画面が見ていた版のままなら書く** (docs/87-編集競合対策計画.md §2-4)。
// 食い違っていたら書かずに戻り値で知らせる — useActionState が受け取り、
// エディタの本文はそのままにバナーだけ出す (redirect も revalidatePath も
// 呼ばないので、この応答では画面が描き直されない)。
//
// 引数が (prev, formData) の 2 つなのは useActionState の作法
export async function updateMemoAction(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  await requireUser()
  const itemNo = readItemNo(formData)
  const memo = readText(formData, 'memo')
  const base = readBase(formData)

  // 「このまま上書き」を選んだ送信だけが立てる印。消える版を先に刻む
  if (formData.get('checkpoint') === '1') {
    if (!(await checkpointBeforeOverwrite(itemNo, memo))) {
      return conflictState('checkpointFailed', await getItem(itemNo))
    }
  }

  const result = await saveItemIfUnchanged(itemNo, { memo }, base)
  if (!result.ok) {
    return conflictState(
      result.reason,
      result.reason === 'missing' ? null : result.current,
    )
  }

  warmCircuitsAfterResponse(itemNo, memo)
  revalidateItem(itemNo)
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
  // 読んで書くまでの間に別の端末の保存が入ると、それを丸ごと消してしまう。
  // modifyMemo は「基点が同じなら書く」で、負けたら読み直して当て直す
  // (docs/87-編集競合対策計画.md §2-5)。**行番号で対象を指す書き換えなので、
  // 行がずれていたら当て直さない** — ずれた先が偶然タスク行だと、別の項目を
  // 裏返してしまう
  const result = await modifyMemo(
    itemNo,
    (memo) => toggleTaskLine(memo, line, checked),
    { canRetry: differsOnlyInTaskMarks },
  )
  if (result === 'missing') {
    throw new Error('ノートが見つかりません')
  }
  if (result === 'rejected') {
    throw new Error('本文が変わっています。画面を更新してください')
  }
  // これで Next.js が同じ応答の中でこのルートを描き直す (server-actions.md)。
  // 画像回転と違い router.refresh() は要らない。
  //
  // 1 回押すごとに ItemView 全体の再描画 (renderCircuits 込み) を払うことは
  // 承知のうえ。テキストタブと**まだ開いていない編集タブ**は本文をサーバ描画
  // から受け取るので、ここを省くと押した結果が反映されない画面が残る。
  // まとめ送りにしないのは、押した分だけ即保存されるほうが単語帳向きなため
  revalidateItem(itemNo)
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
  values: number[],
  unit: string,
): Promise<void> {
  await requireUser()
  if (!isValidItemNo(itemNo)) {
    throw new Error('itemNo が不正です')
  }
  // 誰でも叩ける POST の口なので、型も自分で確かめる (画面を通さず呼べる)。
  // 値は配列 (血圧のような対の値。docs/83 §9) なので、中身まで見る
  if (
    typeof date !== 'string' ||
    typeof item !== 'string' ||
    typeof unit !== 'string' ||
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > MAX_MEASURE_VALUES ||
    // every は**穴を飛ばす**ので、長さと突き合わせて疎配列を落とす
    // (`[ ,1]` は typeof の検査を素通りする)
    values.filter((value) => Number.isFinite(value)).length !== values.length
  ) {
    throw new Error('記録の値が不正です')
  }
  // 書き換えは modifyMemo に任せる (docs/87 §2-5)。**canRetry は渡さない** —
  // 記録の位置は本文 (フェンスと日付) で決まり、行番号に依らないので、
  // 読み直して当て直しても同じ場所に着く
  const result = await modifyMemo(itemNo, (memo) => {
    const next = recordMeasurement(memo, { date, item, values, unit })
    if (next === null) {
      return null
    }
    // **本文が伸びる経路なので長さも検める。** フォーム経由の保存は readText が
    // 見ているが、ここは FormData を通らない。項目名を変えながら叩けば同じ日付の
    // 行にトークンをいくらでも積めてしまい、上限を超えた本文は編集画面から
    // 保存できなくなる (readText が弾く) うえ、git 履歴・ダンプ・オフライン同期の
    // 全部に流れる
    if (next.length > MAX_TEXT_LENGTH) {
      throw new Error(`本文が長すぎます (最大 ${MAX_TEXT_LENGTH} 文字)`)
    }
    return next
  })
  if (result === 'missing') {
    throw new Error('ノートが見つかりません')
  }
  if (result === 'rejected') {
    throw new Error('この値は記録できません')
  }
  revalidateItem(itemNo)
  // 一覧も無効にする。記録は本文そのものなので、一覧のプレビューや
  // 検索結果が古いままになる (toggleMemoTaskAction と同じ判断)
  revalidatePath('/')
}

// Ver1 の /edit/:itemNo POST 相当: mode / memo / url を更新 (未登録なら作成)。
// 競合の扱いは updateMemoAction と同じ (docs/87 §2-4)
export async function updateItemAction(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  await requireUser()
  const itemNo = readItemNo(formData)
  const memo = readText(formData, 'memo')
  const url = readText(formData, 'url')
  const mode = parseMode(formData.get('mode'))
  const base = readBase(formData)

  if (formData.get('checkpoint') === '1') {
    if (!(await checkpointBeforeOverwrite(itemNo, memo))) {
      return conflictState('checkpointFailed', await getItem(itemNo))
    }
  }

  const result = await saveItemIfUnchanged(itemNo, { memo, url, mode }, base)
  if (!result.ok) {
    return conflictState(
      result.reason,
      result.reason === 'missing' ? null : result.current,
    )
  }

  // 編集画面からの保存も同じ (updateMemoAction と揃える)。
  // 図を書いてくるのはむしろこちらの画面
  warmCircuitsAfterResponse(itemNo, memo)
  revalidateItem(itemNo)
  redirect(savedHref(itemNo))
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
