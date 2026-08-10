// 動画の「動くサムネ」(アニメーション WebP) を作る
// (docs/72-動画アニメサムネ計画.md §Phase1)。
//
// 一覧のサムネは静止画なので、それだけでは中身が動画だと伝わりにくい。
// クライアントが動画から抜いた数コマ (videoPoster.ts) を、ここで 1 本の
// アニメーション WebP に束ねる。表示側は普段は静止サムネを出し、ホバー中
// (PC) / 画面に入った時 (スマホ) だけこれに差し替える (useAnimThumb.ts)。
//
// **サーバに ffmpeg を持ち込まない**方針は poster と同じ (videoPoster.ts の
// 冒頭)。動画そのものをデコードできるのはアップロード時のブラウザだけなので、
// サーバの仕事は「受け取ったコマを検算して束ねる」ことに限る。
//
// なぜ GIF ではなく WebP か: 13-kick-work の実測 (3秒 / 8fps / 320px) で
// GIF 約 1.1MB に対し WebP 約 100KB。<img> にそのまま入る点は GIF と同じ。
//
// **クライアントから import しないこと。** sharp は Node 専用で、client
// component から辿ると `fs` がクライアントバンドルに入って壊れる
// (thumbnail.ts と同じ理由。コマの抽出側は videoPoster.ts に置く)。

import sharp from 'sharp'
import { MAX_INPUT_PIXELS } from '../thumbnail'
import { MAX_VIDEO_ANIM_FRAMES } from '../uploads'

// 出力の一辺 (px)。静止サムネ (THUMB_MAX_PX = 384) より一段小さくする。
// 差し替えは「動いていることが判る」ためのもので、細部を読ませる用途ではない。
// コマ数ぶんバイトが積み上がるので、一辺を落とす効きが静止画より大きい。
export const VIDEO_ANIM_MAX_PX = 320

// コマ送りの間隔 (ms)。コマは動画**全体**から等間隔に抜いてある (videoPoster.ts)
// ので、これは元の再生速度とは無関係の「紙芝居の速さ」。速すぎると何も
// 読み取れないため、8 コマで約 3.2 秒かけて一巡させる。
export const VIDEO_ANIM_DELAY_MS = 400

// アニメとして成立する最小のコマ数。
//
// 2 コマでも技術的にはアニメになるが、「動くサムネ」としては点滅にしかならず、
// 静止サムネで足りる。抽出が途中で打ち切られた (シークの遅い動画) ときの
// 足切りでもある。sharp の join は 2 枚未満で例外を投げるので、その下限も兼ねる。
export const MIN_VIDEO_ANIM_FRAMES = 3

// 出来上がりの上限バイト。超えたら採用しない (静止サムネのまま)。
//
// 一覧を軽くするための差し替えが重くては本末転倒 — スマホでは 1 画面ぶん
// まとめて引くことになるため、1 本あたりで抑える必要がある。捨てても配信が
// 404 を返して静止のままになるだけで、絵が割れることはない。
export const MAX_VIDEO_ANIM_BYTES = 300 * 1024

// libwebp の品質。13-kick-work の実測で 50 が静止画サムネ相当の見え方。
const VIDEO_ANIM_QUALITY = 50

// ヘッダのチャンクを歩くのに読むバイト数。ANIM は VP8X の直後に来るので
// 先頭 128B で足りる。
const WEBP_PROBE_BYTES = 128

// アニメーション WebP か (RIFF の中に ANIM チャンクがあるか) を返す。
//
// 13-kick-work では、ffmpeg が rc=0 のまま 1 コマだけの静止画を吐くことが
// 実測で約 300 件に 1 件あった。こちらは ffmpeg を使わないが、「例外は出て
// いないのに動かないサムネが保存される」経路は同じように作れてしまう
// (コマが実質同一・join が 1 ページに畳む等)。出来上がりを自分で検算して、
// 動かないものを DB に残さない。
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, WEBP_PROBE_BYTES)
  if (head.byteLength < 16) {
    return false
  }
  if (ascii(head, 0, 4) !== 'RIFF' || ascii(head, 8, 12) !== 'WEBP') {
    return false
  }
  // RIFF ヘッダの後ろに チャンク (fourcc 4B + size 4B + 中身) が並ぶ
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  let pos = 12
  while (pos + 8 <= head.byteLength) {
    if (ascii(head, pos, pos + 4) === 'ANIM') {
      return true
    }
    const size = view.getUint32(pos + 4, true)
    // チャンクは偶数境界に揃う
    pos += 8 + size + (size % 2)
  }
  return false
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

// 縦横比を保ったまま VIDEO_ANIM_MAX_PX の箱に収めた大きさ (拡大はしない)。
function fitInside(width: number, height: number): { w: number; h: number } {
  const scale = Math.min(1, VIDEO_ANIM_MAX_PX / Math.max(width, height))
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  }
}

// クライアントが抜いたコマ (JPEG) から動くサムネを作る。作れなければ null。
//
// **例外を投げない**のは意図的 (makeThumbnail / makeVideoPoster と同じ流儀)。
// 動くサムネは「あれば嬉しい派生物」で、これのために動画のアップロードを
// 失敗させる価値はない。null のときは thumbAnim が空のまま保存され、配信が
// 404 を返して表示は静止サムネのままになる。
export async function makeVideoAnim(
  frames: Uint8Array[],
  // ログに出す手がかり。「この動画だけ」なのか「sharp ごと動いていない」のかを
  // 切り分けられるようにする (thumbnail.ts と同じ)
  label = '(名前なし)',
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (frames.length < MIN_VIDEO_ANIM_FRAMES) {
    // 抽出が途中で打ち切られた動画。静止サムネで足りるので警告も出さない
    return null
  }
  // 受け取った枚数をそのまま信じない。route が同じ上限で切ってから渡すが、
  // 縮小はコマ数ぶん sharp を回すので、入口が増えたときに素通ししないよう
  // ここでも頭打ちにする (このファイルの流儀は「出来上がりを自分で検算する」)
  const capped = frames.slice(0, MAX_VIDEO_ANIM_FRAMES)

  try {
    // 出力の寸法は **1 コマ目から決める**。sharp の join は寸法違いでも例外を
    // 投げず、1 コマ目に合わせて余白を入れる (実測) ため、揃えずに渡すと
    // 動かした瞬間に絵が飛び跳ねる。ここで全コマを同じ寸法へ写す
    const meta = await sharp(capped[0], {
      failOn: 'none',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata()
    if (!meta.width || !meta.height) {
      return null
    }
    const { w, h } = fitInside(meta.width, meta.height)

    // **コマごとに縮めてから join する。** join の後ろに resize を置くと
    // ページの扱いが失われ、出来上がりが 1 枚の静止画に潰れる (実測)。
    // 解凍爆弾よけ (limitInputPixels) もここで 1 コマずつ効かせる — 束ねてから
    // では合計で判定され、どのコマが悪いかに関係なく丸ごと落ちる
    const resized: Buffer[] = []
    for (const frame of capped) {
      resized.push(
        await sharp(frame, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS })
          // fill ではなく cover。寸法違いのコマが来ても引き伸ばさず切り取る
          // (正しいクライアントでは全コマ同寸なので、この分岐は効かない)
          .resize(w, h, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 90 })
          .toBuffer(),
      )
    }

    const anim = await sharp(resized, { join: { animated: true } })
      .webp({
        quality: VIDEO_ANIM_QUALITY,
        loop: 0,
        // **配列で渡すこと。** 数値 1 つだと 1 コマ目にしか効かず、残りは
        // 既定の 100ms になる (実測)
        delay: new Array(resized.length).fill(VIDEO_ANIM_DELAY_MS),
      })
      .toBuffer()

    if (!isAnimatedWebp(anim)) {
      console.warn(`動くサムネが静止画になったので捨てます (${label})`)
      return null
    }
    if (anim.byteLength > MAX_VIDEO_ANIM_BYTES) {
      console.warn(
        `動くサムネが大きすぎるので捨てます (${label}, ${anim.byteLength} > ${MAX_VIDEO_ANIM_BYTES} bytes)`,
      )
      return null
    }
    // Buffer は使い回しのプールを指しうるため、自前の ArrayBuffer へ写す
    // (Prisma の Bytes は ArrayBuffer 実体の Uint8Array だけを受ける)
    return new Uint8Array(anim)
  } catch (error) {
    console.error(
      `動くサムネの生成に失敗しました (${label}, ${frames.length} コマ):`,
      error,
    )
    return null
  }
}
