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
//
// **デモには送らない** (docs/38-デモモード計画.md)。デモは共有アカウントなので
// 履歴を持たず、口を塞がずに「空を返す」で断る (docs/59 §7)。持たない相手に
// 送っても永久に受け取られないので、送る前に降りる。デモかどうかを知っているのは
// サーバだけなので、呼び出し側 (SearchForm) から渡してもらう。

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
//
// やり直しが効くのは**一時的な失敗**だけ、というのが要点。圏外・500 なら
// importSavedQueries が null を返し、次の機会に同じ物を送れる。一方デモは
// 何度送っても受け取らない (§ 冒頭) ので、やり直しても永久に終わらない。
// そこで isDemo で送る前に降りる。
export async function migrateLegacyQueries(
  isDemo: boolean,
): Promise<QueryLists | null> {
  if (isDemo) {
    return null
  }

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

  // ここまで来たら「サーバが受け取った」と見てよい。以前は保険として
  // 「200 だが saved が空なら鍵を残す」を置いていたが、**その応答を返すのは
  // デモだけ**で、デモは何度送っても同じ応答を返す。結果、検索窓を開くたびに
  // 送り直す無限ループになっていた。デモは上で降りるようにしたので、この
  // 分岐ごと外す (一時的な失敗は importSavedQueries の null 側で拾える)。

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
