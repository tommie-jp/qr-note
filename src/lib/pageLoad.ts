// 「画面の読み込みが終わってから」動かすための小さな待ち合わせ。
//
// **なぜ要るか。** 読み込み中に重い通信を始めると、ページ自身の残りを飢えさせる。
// 実測 (v0.22.67 / iPhone の PWA): デプロイ直後の初回起動で OfflineSync が
// 全ノート同期と暖機 (殻の全チャンク) を撃ち、HTML のストリームがその後ろに
// 並んで、**ヘッダーだけ出たまま数十秒 DCL も load も来ない**状態になった。
//
// マウント時ではなく load 後に始めれば、奪い合う相手がいなくなる。
// 遅れて困る処理ではない (オフライン用の下ごしらえは数秒遅れても等価)。

interface LoadEventTarget {
  addEventListener(type: 'load', listener: () => void, options?: { once: boolean }): void
  removeEventListener(type: 'load', listener: () => void): void
}

interface ReadyStateSource {
  readyState: string
}

// 読み込みが終わっていれば即座に、まだなら load で 1 度だけ run を呼ぶ。
// 戻り値を呼ぶと待ち合わせを解く (React の効果の後始末で使う)。
// win / doc はテストのため。
export function onPageLoaded(
  run: () => void,
  win: LoadEventTarget = window,
  doc: ReadyStateSource = document,
): () => void {
  // complete = load が済んでいる。ここで待つと永久に来ない
  if (doc.readyState === 'complete') {
    run()
    return () => {}
  }

  let done = false
  const listener = () => {
    if (done) {
      return
    }
    done = true
    run()
  }
  win.addEventListener('load', listener, { once: true })
  return () => {
    done = true
    win.removeEventListener('load', listener)
  }
}
