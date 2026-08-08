// localStorage に残っている検索履歴の引き取り (docs/59-検索候補計画.md §7)。
//
// **一時的なファイル**。置き場を localStorage からサーバへ移したので、移す前の
// 版で登録したパターンを一度だけサーバへ送る。全員の端末が通り終わったら、
// このファイルと呼び出し (SearchForm) をまとめて削除する。
//
// 引き取るのは**登録パターンだけ**。最近の検索は数回検索すれば貯まり直すが、
// 登録パターンは利用者が自分で選んで置いた物なので、黙って消えると困る。
//
// 送れたら localStorage の鍵は消す。**利用者ごとの済み印は持たない** — 鍵を
// 消してしまえば、同じ端末で別の人がログインしても引き取る物が残っていない
// (他人の登録パターンを取り込んでしまう事故がそもそも起きない)。

import { importSavedQueries } from './searchQueryClient'
import { sanitizeQueryList, type QueryLists } from './searchQueries'

const SAVED_KEY = 'qr-search-saved'
const RECENT_KEY = 'qr-search-recent'

// 移す前の版が書いた登録パターン。読めなければ空。
function readLegacySaved(storage: Storage): string[] {
  try {
    const raw = storage.getItem(SAVED_KEY)
    return raw === null ? [] : sanitizeQueryList(JSON.parse(raw))
  } catch (e) {
    // 壊れた JSON。読めない物は復旧できないので、空として鍵ごと片付ける
    console.warn('searchQueryLegacy: 古い登録パターンを読めなかった', e)
    return []
  }
}

// localStorage に残りがあれば引き取る。
//
// 戻り値は引き取った後のリスト。引き取る物が無かった場合と、送れなかった
// 場合はどちらも null (呼び出し側は普段どおり fetchQueries を使えばよい)。
//
// **送れなかったら鍵を残す**。消してから失敗すると、利用者が登録した
// パターンがどこにも無くなる。次に検索窓を開いたときにやり直せばよい。
export async function migrateLegacyQueries(): Promise<QueryLists | null> {
  let storage: Storage
  try {
    if (typeof window === 'undefined') {
      return null // サーバ描画中
    }
    storage = window.localStorage
  } catch {
    return null // 参照そのものが例外になる設定 (一部のプライベートモード)
  }

  // 鍵が 1 つも無ければ、この端末は移行済みか初めて使う端末
  if (storage.getItem(SAVED_KEY) === null && storage.getItem(RECENT_KEY) === null) {
    return null
  }

  const legacy = readLegacySaved(storage)
  const lists = await importSavedQueries(legacy)
  if (lists === null) {
    return null
  }

  // **受け取った証拠が無いなら鍵を消さない**。デモは口を塞がず「空を返す」で
  // 断る (docs/59 §7) ので、200 が返ってきても入っていないことがある。送った
  // のに登録パターンが 1 つも無い応答は、入っていない合図として扱う。
  //
  // 上限で一部が落ちた場合は 1 つ以上返るので、ここには来ない (落ちたのは
  // いちばん使っていないパターンで、それは仕様どおり)
  if (legacy.length > 0 && lists.saved.length === 0) {
    console.warn('searchQueryLegacy: 引き取りが反映されなかったので鍵は残す')
    return null
  }

  try {
    // 最近の検索は送らずに捨てる。数回検索すれば貯まり直す
    storage.removeItem(SAVED_KEY)
    storage.removeItem(RECENT_KEY)
  } catch (e) {
    // 消せなくても引き取りは済んでいる。次回は同じ物を送って
    // importSavedQueries が重複を弾くだけなので、害は無い
    console.warn('searchQueryLegacy: 古い鍵を消せなかった', e)
  }
  return lists
}
