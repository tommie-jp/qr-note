// Cache Storage の棚の名前 (docs/65-オフライン対応計画.md §10)。
//
// **正本は public/sw.js のほうにある。** あちらは静的ファイルとして配られる
// 素の JS で、この束から import できないため、名前だけが二重に書かれている。
// **片方を直したら必ず対で直すこと** (order.ts と prefs/sortOrder.ts の関係と同じ)。
// ずれると「保存したのに返らない」— 圏外で初めて気づく壊れ方になる。
//
// 棚を分けているのは、**捨てる判断が棚ごとに違う**ため:
//
//   qr-shell-<版> … /offline の殻。版が変われば丸ごと捨てる
//   qr-media-v2   … 見たついでに貯まった添付。上限 600 件で古い順に捨てる
//   qr-pin-v2     … 印付きノートの持ち出し。**上限も期限も無い**。捨てるのは
//                    印を外したときだけ (pinCache.ts が突き合わせて消す)

//   qr-secret-v1  … シークレット断片の暗号文。名前が UUID で中身が変わらない
//
// media / pin の v1 → v2 は、写真の撮影情報を抜いたバックフィルの後 (docs/113
// §8-5)。v1 の写しには撮影情報が残っているので、名前を変えて捨てさせた。
// **原本のバイト列を書き換える作業をしたら、また上げる**。
// 棚を足したら public/sw.js の activate の一覧にも足す (sw.test.ts が見張る)

import 'client-only'

export const MEDIA_CACHE = 'qr-media-v2'
export const PIN_CACHE = 'qr-pin-v2'
export const SECRET_CACHE = 'qr-secret-v1'
// v2 を取り直し終えたら捨てる旧い持ち出しの棚 (sw.js の LEGACY_PIN_CACHE と対)
export const LEGACY_PIN_CACHE = 'qr-pin-v1'

// 保存済みの応答を捨てる。**中身を書き換えた後に呼ぶ** — 添付は UUID で
// 名前が変わるので取り直しが要らないが、シークレット断片は**同じ名前のまま
// 中身が変わる**唯一の口 (編集は同名上書き。docs/51 §9)。捨てないと、
// 編集したはずの断片が圏外で古いまま復号される。
//
// 失敗しても投げない。消せないのはキャッシュが使えない環境 (= そもそも
// 古い物も残らない) か、その棚がまだ無いときで、どちらも困らない。
export async function forgetCachedUrl(url: string): Promise<void> {
  if (typeof caches === 'undefined') {
    return
  }
  try {
    await Promise.all(
      [MEDIA_CACHE, PIN_CACHE, SECRET_CACHE].map(async (name) => {
        const cache = await caches.open(name)
        await cache.delete(url)
      }),
    )
  } catch (error) {
    console.warn(`端末のキャッシュから ${url} を消せませんでした`, error)
  }
}
