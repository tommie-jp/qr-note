// 動画のサムネ用のコマをクライアントで抜く (docs/14-動画挿入計画.md §Phase3,
// docs/72-動画アニメサムネ計画.md §Phase2)。サーバに ffmpeg を持ち込まずに
// 一覧・<video poster> 用のサムネを用意するための唯一の経路。
//
// 出すものは 2 つ:
//   - poster … 静止サムネ。一覧の既定の絵であり <video poster> でもある
//   - frames … 動くサムネ (アニメ WebP) の材料。動画**全体**から等間隔に抜く
// 束ねるのはサーバ (video/videoAnim.ts)。ここは「絵を取る」ところまでを持つ。
//
// **失敗しても投げない** (poster は null、frames は空)。サムネはあれば嬉しい
// 派生物で、これのためにアップロードを止める価値はない (画像の makeThumbnail と
// 同じ流儀)。iOS カメラロールの HEVC など、そのブラウザがデコードできない動画
// では 1 コマも描けず、サムネ無しで保存される。
//
// **thumbnail.ts / videoAnim.ts (sharp) を import しないこと。** これはクライアント
// (MemoEditorInner) から読まれるモジュールで、sharp を引き込むと Node 専用の
// `fs` がクライアントバンドルに入って壊れる (E2E で 500 になり判明)。サーバは
// 受け取った絵を作り直す (poster は makeThumbnail、コマは makeVideoAnim) ので、
// ここの縮小は「送信量を抑える前処理」でよく、寸法を厳密に揃える必要はない。

import { MAX_VIDEO_ANIM_FRAMES } from '@/lib/uploads'
import { FIRST_FRAME_SEC, frameTimes } from './frameTimes'

// クライアント側の静止サムネの一辺 (px)。サーバの THUMB_MAX_PX (384) と
// 揃えてあるが、独立した定数として持つ (sharp を引き込まないため)。
const POSTER_MAX_PX = 384

// 動くサムネのコマの一辺 (px)。サーバの VIDEO_ANIM_MAX_PX (320) と揃えてある。
// コマ数ぶん送るので静止より一段小さくする。
const ANIM_FRAME_MAX_PX = 320

// 先頭コマの取得を待つ上限。壊れた動画・デコードできない動画で
// 永久に待たないための保険。モバイルのデコードを見込んで少し長めにする。
const LOAD_TIMEOUT_MS = 8000

// 動くサムネのコマ集めに使ってよい時間の上限。
//
// シークの速さは動画のキーフレーム間隔と端末に大きく左右され、長尺・高解像度の
// 録画では 1 回に数百 ms かかることがある。**間に合ったぶんだけで作る**
// (足りなければサーバ側が MIN_VIDEO_ANIM_FRAMES で諦め、静止サムネだけになる)。
// 挿入のたびに待たされるより、動くサムネが無いほうがましなので上限を優先する。
const ANIM_BUDGET_MS = 6000

// 1 回のシークを待つ上限。全体の予算 (ANIM_BUDGET_MS) とは別に、1 回が
// 返ってこない動画で予算を丸ごと食わせないための刻み。
const SEEK_TIMEOUT_MS = 2000

// 既にその位置にいるとみなす誤差 (秒)。currentTime は要求どおりの値には
// ならない (最寄りのフレームに丸められる) ので、厳密比較はできない。
const SEEK_EPSILON_SEC = 0.001

// 出力は **JPEG**。canvas.toBlob('image/webp') は Safari (iOS) が出せず
// PNG に化けるため、全ブラウザが確実に出せる JPEG にする。サーバが sharp で
// webp へ作り直すので (uploads.ts isValidVideoThumb / isValidVideoAnimFrame)、
// ここが webp である必要はない。
const POSTER_MIME = 'image/jpeg'
const POSTER_QUALITY = 0.85
// コマは枚数ぶん積み上がるので、静止より落とす (サーバが再エンコードするため、
// ここは「送信量を抑える前処理」でしかない)
const ANIM_FRAME_QUALITY = 0.7

export interface VideoThumbs {
  // 静止サムネ。作れなければ null
  poster: Blob | null
  // 動くサムネの材料。作らない/作れないときは空配列
  frames: Blob[]
}

const NO_THUMBS: VideoThumbs = { poster: null, frames: [] }

// 縦横比を保ったまま maxPx の箱に収めた描画サイズを求める。
function fitInside(
  width: number,
  height: number,
  maxPx: number,
): { w: number; h: number } {
  if (width <= 0 || height <= 0) {
    return { w: 0, h: 0 }
  }
  const scale = Math.min(1, maxPx / Math.max(width, height))
  return { w: Math.round(width * scale), h: Math.round(height * scale) }
}

// いま描けるフレームを canvas へ写して Blob にする。描けなければ null。
function drawFrame(
  video: HTMLVideoElement,
  maxPx: number,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const { w, h } = fitInside(video.videoWidth, video.videoHeight, maxPx)
      if (w === 0 || h === 0) {
        resolve(null) // まだフレーム寸法が無い (描けない)
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }
      ctx.drawImage(video, 0, 0, w, h)
      canvas.toBlob((blob) => resolve(blob), POSTER_MIME, quality)
    } catch {
      // CORS 汚染・デコード不可などで描けない場合
      resolve(null)
    }
  })
}

// 最初に描けるフレームが来るまで待つ。来なければ false。
function waitForFirstFrame(video: HTMLVideoElement): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timer)
      video.onloadeddata = null
      video.onerror = null
      resolve(ok)
    }
    const timer = window.setTimeout(() => finish(false), LOAD_TIMEOUT_MS)
    video.onloadeddata = () => finish(true)
    video.onerror = () => finish(false)
    // iOS はフレームのデコードを再生で促さないと canvas に描けないことがある。
    // muted なので自動再生は許される。失敗は無視 (onloadeddata 側で描く)
    void video.play?.().catch(() => {})
  })
}

// 指定時刻へシークし、そのフレームが描けるようになるまで待つ。
function seekTo(video: HTMLVideoElement, sec: number): Promise<boolean> {
  if (Math.abs(video.currentTime - sec) <= SEEK_EPSILON_SEC) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      resolve(ok)
    }
    const onSeeked = () => finish(true)
    const onError = () => finish(false)
    const timer = window.setTimeout(() => finish(false), SEEK_TIMEOUT_MS)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    try {
      video.currentTime = sec
    } catch {
      // シークできない動画 (duration 不正な録画など)
      finish(false)
    }
  })
}

// 動画ファイルから静止サムネと動くサムネのコマを作る。
export async function makeVideoThumbs(file: File): Promise<VideoThumbs> {
  if (typeof document === 'undefined') {
    return NO_THUMBS
  }
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  // 音を出さず、勝手に全画面へ行かせず、実データまで読ませる (preload=metadata
  // だと描けるフレームが揃わないことがある)
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url

  try {
    if (!(await waitForFirstFrame(video))) {
      return NO_THUMBS
    }
    // ここから先は自分でコマを送るので再生は止める。再生したままシークすると
    // 描いた時刻とシーク先がずれる
    video.pause()

    // コマの時刻。空 = 動くサムネは作らない (短すぎる・尺が判らない動画)
    const times = frameTimes(video.duration, MAX_VIDEO_ANIM_FRAMES)

    // 静止サムネは必ず先頭付近から描く (真っ黒回避)。シーク不可・duration 不正な
    // 録画では、その場のフレームをそのまま描く
    const canSeek =
      Number.isFinite(video.duration) && video.duration > FIRST_FRAME_SEC
    if (canSeek) {
      await seekTo(video, FIRST_FRAME_SEC)
    }
    const poster = await drawFrame(video, POSTER_MAX_PX, POSTER_QUALITY)
    if (!poster || !canSeek || times.length === 0) {
      // poster すら描けない動画からコマを集めても仕方がない
      return { poster, frames: [] }
    }

    // コマ集め。**間に合ったぶんだけ**返す (足りなければサーバが諦める)。
    // 1 コマ目は poster と同じ位置なので、シークせずそのまま描ける
    const frames: Blob[] = []
    const deadline = Date.now() + ANIM_BUDGET_MS
    for (const [index, sec] of times.entries()) {
      if (Date.now() > deadline) {
        break
      }
      if (index > 0 && !(await seekTo(video, sec))) {
        break
      }
      const frame = await drawFrame(video, ANIM_FRAME_MAX_PX, ANIM_FRAME_QUALITY)
      if (!frame) {
        break
      }
      frames.push(frame)
    }
    return { poster, frames }
  } finally {
    URL.revokeObjectURL(url)
    video.removeAttribute('src')
    video.load()
  }
}
