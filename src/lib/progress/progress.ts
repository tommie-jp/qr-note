// 進捗 % の純粋な計算だけを持つ (DOM もネットワークも触らない)。
// アップロード (XHR) と OCR モデルダウンロードが共用する。

// 合算ダウンロードの頭打ち。圧縮転送では受信バイトが Content-Length を
// 超え得るため、完了イベントが来るまで 100% を名乗らない
const AGGREGATE_CAP_PERCENT = 99

// 1 本のダウンロードの進み具合。total は Content-Length が無ければ null
export interface DownloadState {
  loaded: number
  total: number | null
}

// loaded/total を 0-100 に丸めた整数 %。total が不正なら 0
export function bytesPercent(loaded: number, total: number): number {
  if (total <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.floor((loaded / total) * 100)))
}

// bytesPercent を cap で頭打ちにする (送信完了後もサーバ処理を待つ間など)
export function cappedPercent(loaded: number, total: number, cap: number): number {
  return Math.min(cap, bytesPercent(loaded, total))
}

// 複数ダウンロードの合算 %。分母は「判明している total の合計」と
// 「セット全体の見込みバイト数 (expectedTotalBytes)」の大きい方を採る。
//
// 素朴に判明分だけで割ると **% が逆走する**: 2 本を並行取得するとき、
// 1 本目のチャンクが届いてから 2 本目の Content-Length が判明するまでの間は
// 分母が 1 本分しかなく、90% まで伸びてから 2 本目の登録で 25% へ落ちる。
// 見込み総量を下限にしておけば分母は縮まないので単調に増える。
export function aggregatePercent(
  downloads: readonly DownloadState[],
  expectedTotalBytes: number,
): number {
  if (downloads.length === 0) {
    return 0
  }
  const loaded = downloads.reduce((sum, d) => sum + d.loaded, 0)
  const knownTotal = downloads.reduce((sum, d) => sum + (d.total ?? 0), 0)
  return cappedPercent(
    loaded,
    Math.max(knownTotal, expectedTotalBytes),
    AGGREGATE_CAP_PERCENT,
  )
}
