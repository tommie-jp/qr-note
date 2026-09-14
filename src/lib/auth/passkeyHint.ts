// 「このブラウザでパスキーが使えた実績があるか」の記憶
// (docs/29-パスキー計画.md §13)。
//
// 自動ログインを出してよいかの判断に使う。**サーバの登録有無では判断しない**
// のが要点 — サーバが知っているのは「どこかの端末に鍵がある」ことだけで、
// いま画面を開いているブラウザに鍵があるかは分からない。鍵を持たない端末で
// 自動発火させると、いきなり「他のデバイスで QR を読み取ってください」の
// ハイブリッド画面が出て、初見では事故に見える。
//
// **認可の判断には一切使わない。** ここが偽造されても起きるのは
// 「本人の Face ID ダイアログが出る」だけで、検証は従来どおりサーバの
// チャレンジと署名で行う。だから localStorage に置いてよい。
//
// storage が使えない環境 (プライベートモード、storage 無効) では
// **すべて「無し」に倒れる**。自動が出なくなるだけで、手動のログインは無傷。

import 'client-only'
import { browserStorage, defineBooleanPref } from '../prefs/storagePref'

const HINT_KEY = 'qr-passkey-used-here'
const SUPPRESS_KEY = 'qr-passkey-auto-suppressed'

// 置く値は '1' だけ (defineBooleanPref の印)。利用者名などは置かない
// (漏れて困るものを増やさない)
const HINT = defineBooleanPref(HINT_KEY, false)
const SUPPRESS = defineBooleanPref(SUPPRESS_KEY, false)

// storage へのアクセスはすべて prefs/storagePref.ts を通す。window が無い
// (Server Component から間接的に呼ばれた) ときも、storage はあるが触ると投げる
// (Safari のプライベートモードなど) ときも、読めば「無い」、書けば何もしない
// に倒れる — 自動を出さない側。書けなくても実害は「次回も自動が出ない」だけ

// パスキーのログイン / 登録が成功した直後に呼ぶ。
export function markPasskeyUsedHere(): void {
  HINT.save(browserStorage('localStorage'), true)
}

// パスキーが 1 つも登録されていないと分かったとき (login-options が 404) に呼ぶ。
// 残したままだと、鍵が消えているのに毎回自動発火を試みることになる。
// 消せなくても、次の自動発火が空振りして 404 でまたここへ来るだけ
export function clearPasskeyHint(): void {
  HINT.remove(browserStorage('localStorage'))
}

export function hasPasskeyHint(): boolean {
  return HINT.load(browserStorage('localStorage'))
}

// 自動発火を利用者が取り消したときに呼ぶ。
//
// **タブ単位 (sessionStorage) にするのが要点。** 取り消した直後に別の保護
// ページへ移動するたびダイアログが出るのは不快だが、恒久的に無効化すると
// 「一度キャンセルしたら二度と自動で出ない」になってしまう。タブを開き直せば
// 元に戻る、が落としどころ。
export function suppressAutoLogin(): void {
  SUPPRESS.save(browserStorage('sessionStorage'), true)
}

export function isAutoLoginSuppressed(): boolean {
  return SUPPRESS.load(browserStorage('sessionStorage'))
}
