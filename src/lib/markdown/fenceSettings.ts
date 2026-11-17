// 「1 行目は検索式、2 行目以降は `キー=値`」のフェンスの読み方
// (```matrix・```health が使う。docs/77 §3・docs/83 §4)。
//
// 同じ見た目のフェンスが 2 通りの文法を持たないように、区切り (全角 ＝ を許す)・
// 畳み方 (キーだけ NFKC)・空行の扱いをここ 1 か所に置く。キーごとの意味と
// 知らないキーの扱いは各フェンスが持つ。

// キー=値 の区切り。全角の ＝ も区切りとして認める
function separatorIndex(line: string): number {
  const half = line.indexOf('=')
  const full = line.indexOf('＝')
  if (half < 0) {
    return full
  }
  return full < 0 ? half : Math.min(half, full)
}

export interface FenceSource {
  query: string
  settingLines: string[]
}

// 1 行目 (検索式) と 2 行目以降 (設定) に割る
export function splitFenceSource(source: string): FenceSource {
  const lines = source.split(/\r?\n/)
  // 1 行目だけは正規化しない — 検索式の正規化 (NFKC) は tokenize が
  // 自分で行う作法なので、ここで先回りすると引用リテラルの中身まで畳む
  const query = (lines[0] ?? '').trim()
  return { query, settingLines: lines.slice(1) }
}

export type FenceSetting = { key: string; value: string } | { error: string }

// 設定の行を上から 1 つずつ読む。空行は飛ばす。
// **1 行ずつ渡す**ので、呼び手は先の行のエラーを後の行の書式エラーより先に返せる
export function* fenceSettings(lines: readonly string[]): Generator<FenceSetting> {
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') {
      continue
    }
    const eq = separatorIndex(line)
    if (eq <= 0) {
      yield { error: `設定は「キー=値」の形で書きます: 「${line}」` }
      continue
    }
    // **畳むのはキーだけ。** 値は打ったまま持つ (畳む理由が値ごとに違うので、
    // 照合が要るところで呼び手が畳む)
    const key = line.slice(0, eq).normalize('NFKC').trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    yield { key, value }
  }
}
