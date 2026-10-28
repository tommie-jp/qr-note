"use client";

// ビューアが使い回す 1 つの動画要素 (docs/117 §8-4)。
//
// iOS Safari は、利用者の操作の中で play() (または load()) された要素の
// 再生の制限を外し、以後はその要素なら時計から再生しても許す。動画ごとに
// 要素を作ると、スライドショーが時計で送った先は毎回「操作なしの再生」に
// なって拒まれる。そこで要素を 1 つに決め、利用者が押した瞬間 (画像・動画を
// 押して開いた・「スライドショー」・▶・Space) に許可を取っておく。
// ViewerVideo はこの要素を器へ差し込み、src・poster・muted だけを替えて使う。
//
// 要素は最初に要るときに作る (サーバ描画では document が無い)
let shared: HTMLVideoElement | null = null;

export function sharedVideo(): HTMLVideoElement {
  if (shared === null) {
    const video = document.createElement("video");
    // 変わらない設定はここで 1 度だけ。playsinline は iOS で全画面の
    // プレーヤーへ飛ばないために必須 (VideoPlayer と同じ)
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.controls = true;
    video.preload = "auto";
    video.setAttribute("aria-label", "ノートの動画");
    // 器いっぱいに contain で収める (ViewerImage と同じ置き方)
    video.className = "absolute inset-0 h-full w-full bg-black object-contain";
    shared = video;
  }
  return shared;
}

// 開く・始める操作の中で許可を取る。**利用者の操作の処理の中から同期で
// 呼ぶこと** (await の後では効かない)。
//
// load() で許可を取る — 中身が入っていても鳴らさずに済む (play() だと、
// 止めてあった前の動画が一瞬鳴る)。中身が無いときは play() も呼ぶ
// (失敗するが、制限はその前に外れる)
export function unlockSharedVideo(): void {
  const video = sharedVideo();
  const hasSource = Boolean(video.getAttribute("src"));
  video.load();
  if (!hasSource) {
    void video.play().catch(() => {
      // 中身が無い。許可を取るのが目的なので捨ててよい
    });
  }
}

// ▶・Space でスライドショーを始める・再開する操作の中で、いま出ている動画を
// その場で再生する。自動再生を拒まれて「タップで再生」で待っている動画も、
// この操作で流れ始める (許可もここで取れる)。動画を出していなければ
// unlockSharedVideo と同じく許可だけを取る
export function playSharedVideoNow(): void {
  const video = sharedVideo();
  if (!video.getAttribute("src")) {
    unlockSharedVideo();
    return;
  }
  if (video.paused && !video.ended) {
    void video.play().catch(() => {
      // 拒まれたら ViewerVideo の「タップで再生」のまま待つ
    });
  }
}
