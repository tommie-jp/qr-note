// HTTP Range ヘッダ (単一レンジ) の解釈 (RFC 7233)。
//
// <audio> のシークはブラウザが "Range: bytes=start-end" を送ってくる。これに
// 206 Partial Content で応えられないと、Safari など一部ブラウザは音声の途中へ
// 飛べない (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。ここは純粋な計算だけを持ち、
// DB もレスポンスも触らない (配信は route.ts が組み立てる)。
//
// 複数レンジ (bytes=0-9,20-29) と bytes 以外の単位は扱わない。実装が要る割に
// <audio> は使わないため、その場合は null を返し、呼び手は全体を 200 で返す。

export interface ByteRange {
  // どちらも 0-based。end は inclusive (RFC 7233 の Content-Range と同じ約束)。
  start: number
  end: number
}

// 全長 size のリソースに対する Range を解決する。
//   null            … Range 無し / 解釈できない形 → 呼び手は全体を 200 で返す
//   'unsatisfiable' … 形は解釈できたが範囲外 → 呼び手は 416 を返す
//   ByteRange       … 返すべき部分範囲 (start..end inclusive) → 呼び手は 206
export function resolveByteRange(
  header: string | null | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  if (!header) {
    return null
  }
  // 単一レンジだけを受ける。"bytes=" に続く start-end のどちらか一方は省略可。
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) {
    return null
  }
  const [, startText, endText] = match

  // "bytes=-N": 末尾 N バイト。N=0 は「末尾 0 バイト」で満たせない。
  if (startText === '') {
    if (endText === '') {
      return null // "bytes=-" は不正 (両端とも空)
    }
    const suffix = Number(endText)
    if (suffix === 0) {
      return 'unsatisfiable'
    }
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(startText)
  // start が全長以上 (空ファイルを含む) は満たせない
  if (start >= size) {
    return 'unsatisfiable'
  }
  // end 省略は「最後まで」。指定ありは全長-1 で頭打ちにする。
  const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1)
  if (end < start) {
    return 'unsatisfiable'
  }
  return { start, end }
}
