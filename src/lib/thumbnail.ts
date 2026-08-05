// 一覧に並べるためのサムネイル生成 (docs/23-検索結果表示モード計画.md §2)。
//
// 検索結果のカード表示は 1 ページに 20 枚の画像を並べる。images.data は
// アップロードされた原寸のバイト列で、スマホ写真なら 1 枚数 MB ある。CSS で
// 小さく見せてもバイト数は減らないため、縮小したものを別に持って一覧へ配る。
//
// 画像は UUID 名で内容が変わらない (route.ts が immutable で配っている) ので、
// 保存時に 1 度作れば作り直す理由がない。リクエストごとに縮小してキャッシュを
// 持つより単純で、画像 GC (docs/20-画像GC計画.md) とも干渉しない — 行が消えれば
// サムネも一緒に消える。

import sharp from 'sharp'

export const THUMB_MIME = 'image/webp'

// サムネ一辺の px。**縦横比を保ったまま** 384x384 の箱に収める (fit: 'inside')。
//
// 画像表示モードのタイルは画像**全体**を余白付き (object-contain) で見せるよう
// にした (docs/32 §1)。切り抜いた正方形を配ると全体が見えないので、絵は縦横比を
// 保って持つ。かつては正方形に切り抜いて (fit: 'cover') 持っていた — 当時タイルも
// object-cover で覆っており、横長写真では短辺が足りず甘く見えたためだが、タイルを
// contain に変えたことでその理由は消えた。
//
// 残る消費者 (compact 40px / 画像検索モーダル 56px / card 96px) は正方形の
// object-cover のままだが、縦横比維持でも短辺は 4:3 で 288px 確保でき、最大の
// card 96px を 3x DPR で覆える。パノラマ級に細長い絵だけ短辺が痩せるが、これらは
// 小さい枠なので実害は小さい。
//
// 一辺 384px は最大消費者である画像タイル (≒208 CSS px) を約 1.85x DPR まで、
// card/モーダル/compact を 3x 以上まで賄う。単一の大きさで全モードを配る方針は
// 据え置き (枠は CSS で決まり、絵は縮む側に強い)。
//
// 生成パラメータを変えたので既存 thumb は作り直しが要る
// (scripts/backfillThumbs.ts --force)。配信 URL 側もキャッシュを割る
// (memoImages.ts の thumbUrl の版)。
export const THUMB_MAX_PX = 384

// 展開後のピクセル数の上限 (解凍爆弾よけ)。
//
// アップロードは 10MB (MAX_IMAGE_BYTES) までに制限してあるが、**バイト数は
// 展開後の大きさを縛らない**。マジックバイト検査 (uploads.ts) が見るのは先頭
// 数バイトだけなので、10MB に収まりながら数万 x 数万を名乗る画像は作れる。
// libvips は resize で縮める前に一度展開するため、上限が無いと 1 枚で GB 単位の
// メモリを掴んでプロセスごと落とせる。
//
// sharp の既定 (約 268MP) は「事故で巨大な画像を開かない」ための値で、悪意ある
// 入力に対しては緩い。50MP は 8000x6000 (48MP) の一眼でも通る大きさなので、
// 実用上これで困ることはない。超えた画像は例外になり、下の catch で null に
// なる (= サムネなしで原寸配信。アップロード自体は成功する)。
//
// この上限は今回はじめて必要になった。sharp はこれまで devDependency で
// アイコン生成にしか使っておらず、ユーザーが投げたバイト列を渡す経路が
// 無かったため。
// HEIC/TIFF → WebP 変換 (normalizeImage) も同じ解凍爆弾よけを共有する
export const MAX_INPUT_PIXELS = 50_000_000

// アニメのままサムネにするフレーム数の上限。
//
// アニメサムネは全フレームを縮小して再エンコードするため、生成時間も出力バイトも
// コマ数に比例して伸びる。saveImage はサムネの完成を待ってから応答する
// (imageStore.ts) ので、長尺 GIF のアップロードで待たせないための上限。
// **上限を超えても静止サムネは作る** (「サムネなし」= 一覧が原寸を配る、には
// しない)。
export const MAX_ANIMATION_FRAMES = 100

// 全フレームを展開してアニメサムネにしてよいか。
//
// libvips は animated: true でフレームを縦に連結した 1 枚として扱う。そのため
// 解凍爆弾よけ (limitInputPixels) は 1 フレームではなく**フレーム合計**に掛かり、
// 1 コマが小さくてもコマ数で上限に触れる。触れると例外になり、先頭フレームだけなら
// 作れたはずの静止サムネまで失われる (= 一覧がその行だけ原寸を配り続ける) ので、
// あらかじめアニメを諦めて静止で作る。
export function canAnimateThumbnail(
  pages: number,
  framePixels: number,
): boolean {
  return (
    pages > 1 &&
    pages <= MAX_ANIMATION_FRAMES &&
    framePixels * pages <= MAX_INPUT_PIXELS
  )
}

// 縮小して webp にする。animated なら全フレームを保つ (アニメ webp になる)。
// 失敗は投げる — 呼び出し側 (makeThumbnail) がアニメ→静止の作り直しと
// null 返却を仕切る。
async function renderThumbnail(
  bytes: Uint8Array,
  animated: boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  // failOn: 'none' … 多少壊れていてもブラウザが表示できる画像は多い。
  // 既定 ('warning') は厳しすぎ、本文では見えている絵のサムネだけが
  // 作られない状態になる。
  const pipeline = sharp(bytes, {
    failOn: 'none',
    limitInputPixels: MAX_INPUT_PIXELS,
    ...(animated ? { animated: true } : {}),
  })

  // EXIF の向きを画素に焼く。スマホ写真は横倒しのまま保存され、向きは
  // EXIF にしか入っていない。ここで起こさないと一覧だけ倒れて出る
  // (本文側はブラウザが EXIF を見るので正しく出てしまい、食い違う)。
  //
  // アニメでは向き補正を掛けない — animated: true で .rotate() (自動向き) を
  // 通すとページ高の扱いで崩れうる。GIF は EXIF の向きを持たないので実害はなく、
  // アニメ WebP に向きが入っていた場合だけ本文と食い違う (稀)
  const oriented = animated ? pipeline : pipeline.rotate()

  const thumb = await oriented
    .resize(THUMB_MAX_PX, THUMB_MAX_PX, {
      // 縦横比を保ったまま 384x384 の箱に収める (切り抜かない)。画像モードの
      // タイルは object-contain で全体を見せるので、絵の全体を残す必要がある。
      // 正方形 object-cover の消費者 (compact/モーダル/card) は表示側が枠に
      // 合わせて切り抜くため、こちらが縦横比維持でも困らない。
      fit: 'inside',
      // 原画が箱より小さいときは拡大しない (引き伸ばしはボケる)
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer()

  // Buffer は使い回しのプールを指しうるため、自前の ArrayBuffer へ写す
  // (Prisma の Bytes は ArrayBuffer 実体の Uint8Array だけを受ける)
  return new Uint8Array(thumb)
}

// 原寸のバイト列からサムネイルを作る。作れなければ null。
//
// **例外を投げない**のは意図的。呼び出し側 (saveImage) にとって画像の保存が
// 本題で、サムネはあれば一覧が速くなるだけの派生物である。壊れた EXIF や
// sharp が読めない亜種のために、ユーザの画像アップロードそのものを失敗させる
// 価値はない。null のときは配信側が原寸で代替するので、絵が割れることもない
// (遅くなるだけ)。黙って消えないよう、失敗はログに残す。
export async function makeThumbnail(
  bytes: Uint8Array,
  // ログに出す手がかり (画像名など)。失敗が「この 1 枚が壊れている」のか
  // 「sharp が丸ごと動いていない」のかは、件数と対象が判らないと切り分け
  // られない。ログはヘッダの「ログ」から読める (docs/21-ログ表示計画.md)
  label = '(名前なし)',
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    // まずアニメーションかを判定する。GIF・アニメ WebP は複数ページ (pages > 1)
    // を持つ。一覧でも動かすため、アニメはサムネもアニメ WebP にする
    // (一覧の全モードが ?thumb=1 の webp を <img> で出すので、これで動く)。
    // metadata はヘッダだけ読むので安い。animated を付けずに読むので
    // height はフレーム 1 枚分、pages がコマ数になる
    const meta = await sharp(bytes, {
      failOn: 'none',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata()
    const pages = meta.pages ?? 1
    const framePixels = (meta.width ?? 0) * (meta.height ?? 0)

    if (canAnimateThumbnail(pages, framePixels)) {
      const animated = await renderThumbnail(bytes, true).catch((error) => {
        // アニメだけが失敗することもある。静止で作り直せば一覧は成立するので、
        // ここでは諦めない (何が起きたかはログに残す)
        console.warn(
          `アニメのサムネイル生成に失敗しました。静止で作り直します (${label}, ${pages} コマ):`,
          error,
        )
        return null
      })
      if (animated && animated.byteLength < bytes.byteLength) {
        return animated
      }
      if (animated) {
        // 縮めるためのサムネが原寸より重くては本末転倒 (一覧が原寸を配るより
        // 遅くなる)。コマ数が多くノイズの多い GIF で起こる
        console.warn(
          `アニメのサムネイルが原寸より重いため静止にします (${label}, ${animated.byteLength} > ${bytes.byteLength} bytes)`,
        )
      }
    }

    // 静止サムネ (大多数の画像はここだけを通り、挙動は従来どおり)。アニメでも
    // 上限超え・失敗・重すぎのときはここへ落ちる
    return await renderThumbnail(bytes, false)
  } catch (error) {
    // 名前と大きさを添える。「全部のアップロードで出ている」なら sharp か
    // その native が壊れている (本番は alpine/musl なので入れ違いは起こりうる)、
    // 「特定の 1 枚だけ」ならその画像の問題、と切り分けられるようにする
    console.error(
      `サムネイル生成に失敗しました (${label}, ${bytes.byteLength} bytes):`,
      error,
    )
    return null
  }
}
