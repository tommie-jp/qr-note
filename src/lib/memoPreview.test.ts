import { expect, test } from 'vitest'
import { memoPreview, MEMO_PREVIEW_MAX_LENGTH } from './memoPreview'

test('1 行目 (タイトル) を除いた本文を返す', () => {
  // 1 行目は memoSummary がタイトルとして出すので、本文で繰り返さない
  expect(memoPreview('USB充電器 65W\n出力は 5V 3A')).toBe('出力は 5V 3A')
})

test('複数行は改行で連結する (表示では空白と同じに描かれる)', () => {
  // 表示は line-clamp で 3 行に収める。ここで行数を数えないのは、Markdown 上の
  // 1 行が画面では折り返して 2 行になるため (行の数え方は CSS の仕事)。
  // 区切りを空白にしないのは、別々の行の $ 同士が数式の対に見えないように
  // するため (memoPreview 末尾のコメント参照)
  expect(memoPreview('タイトル\n一行目\n二行目\n三行目')).toBe(
    '一行目\n二行目\n三行目',
  )
})

test('空行は詰める', () => {
  expect(memoPreview('タイトル\n\n\n本文')).toBe('本文')
})

test('ハッシュだけの行は除く (2 行目のタグ表示と重複する)', () => {
  expect(memoPreview('タイトル\n#bjt #npn\n本文')).toBe('本文')
})

test('散文に混じったハッシュは残す (行全体がタグのときだけ落とす)', () => {
  expect(memoPreview('タイトル\nこれは #npn のトランジスタ')).toBe(
    'これは #npn のトランジスタ',
  )
})

test('key=value 行は除く (特性表に出るので重複する)', () => {
  expect(memoPreview('2SC1815\nhFE=208 Vf=700mV\n汎用の小信号用')).toBe(
    '汎用の小信号用',
  )
})

test('散文に混じった key=value は残す (行全体が key=value のときだけ落とす)', () => {
  // props.ts の「行全体が key=value」判定と同じ線引き
  expect(memoPreview('2SC1815\n実測では hFE=195 だった')).toBe(
    '実測では hFE=195 だった',
  )
})

test('画像は除く (サムネとして右端に出るので重複する)', () => {
  expect(memoPreview('書名\n![書影|120](/api/images/x.jpg)\n著者名')).toBe(
    '著者名',
  )
})

test('行に混じった画像はその部分だけ落とす', () => {
  expect(memoPreview('タイトル\n左 ![alt](/api/images/x.jpg) 右')).toBe('左 右')
})

test('Markdown の行頭記法を剥がす', () => {
  expect(memoPreview('タイトル\n- 項目1\n- 項目2')).toBe('項目1\n項目2')
  expect(memoPreview('タイトル\n## 見出し')).toBe('見出し')
  expect(memoPreview('タイトル\n> 引用')).toBe('引用')
})

test('Markdown のインライン記法を剥がす', () => {
  expect(memoPreview('タイトル\n**太字** と `code` と [リンク](https://e.com)')).toBe(
    '太字 と code と リンク',
  )
})

test('長い本文は打ち切って … を付ける', () => {
  const long = `タイトル\n${'あ'.repeat(MEMO_PREVIEW_MAX_LENGTH + 50)}`

  const preview = memoPreview(long)

  expect(preview.length).toBe(MEMO_PREVIEW_MAX_LENGTH + 1)
  expect(preview.endsWith('…')).toBe(true)
})

test('収まる本文には … を付けない', () => {
  expect(memoPreview('タイトル\n短い本文')).toBe('短い本文')
})

// 折りたたみ・アラートの目印は表示では枠に化けるので、プレビューには出さない。
// ただしラベルは書き手が付けた見出しなので残す (docs/54-markdown表示拡張計画.md)
test('折りたたみの囲いを落としてラベルは残す', () => {
  expect(memoPreview('タイトル\n\n:::details[ログ]\n畳んだ中身\n:::')).toBe(
    'ログ\n畳んだ中身',
  )
})

test('ラベルのない折りたたみは囲いだけ落とす', () => {
  expect(memoPreview('タイトル\n\n:::details\n畳んだ中身\n:::')).toBe(
    '畳んだ中身',
  )
})

test('アラートの目印を落とす', () => {
  expect(memoPreview('タイトル\n\n> [!NOTE]\n> 補足です')).toBe('補足です')
})

test('本文が無ければ空文字を返す', () => {
  expect(memoPreview('タイトルだけ')).toBe('')
  expect(memoPreview('')).toBe('')
  expect(memoPreview('タイトル\n#tag\nhFE=208')).toBe('')
})

// 描画フェンス (circuitikz / mermaid / quiz) の中身は落とす (docs/68 §7)。
// ノート表示では図やカードに化けてテキストとして見えない物なので、
// プレビューに流すと画像の alt と同じ「他で見えている物の重複」になる

test('circuitikz フェンスの中身は出さない (前後の散文は残す)', () => {
  const memo = [
    'タイトル',
    '学習済み 自信あり',
    '```circuitikz',
    '\\begin{circuitikz} \\draw (0,0) to[R] (2,0);',
    '\\end{circuitikz}',
    '```',
    '答えは 10V',
  ].join('\n')
  expect(memoPreview(memo)).toBe('学習済み 自信あり\n答えは 10V')
})

test('mermaid と quiz のフェンスの中身も出さない', () => {
  expect(memoPreview('タイトル\n```mermaid\ngraph TD;\n```\n本文')).toBe('本文')
  expect(memoPreview('タイトル\n```quiz\nQ: 問い\n```\n本文')).toBe('本文')
})

test('普通のコードフェンスの中身は今までどおり出す', () => {
  // bash 等はノート表示でもテキスト (コードブロック) として見えている
  expect(memoPreview('タイトル\n```bash\nls -la\n```')).toBe('ls -la')
})

test('閉じ忘れた描画フェンスは末尾まで落とす', () => {
  expect(memoPreview('タイトル\n本文\n```circuitikz\n\\draw (0,0);')).toBe(
    '本文',
  )
})

test('描画フェンスしか無いノートのプレビューは空', () => {
  expect(memoPreview('タイトル\n```circuitikz\n\\draw (0,0);\n```')).toBe('')
})

test('普通のフェンスの後の描画フェンスも落とす (状態が混ざらない)', () => {
  const memo = [
    'タイトル',
    '```bash',
    'ls',
    '```',
    '```circuitikz',
    '\\draw (0,0);',
    '```',
    '結び',
  ].join('\n')
  expect(memoPreview(memo)).toBe('ls\n結び')
})

// インライン数式 (docs/69-一覧数式計画.md)。$...$ の中は TeX であって
// Markdown ではないので、強調・リンク剥がしの対象にしない

test('数式の中の * や ** を強調として剥がさない', () => {
  expect(memoPreview('タイトル\n$x^*$ と $y^*$ の関係')).toBe(
    '$x^*$ と $y^*$ の関係',
  )
  expect(memoPreview('タイトル\n$f(x) = x^{**2**}$ を使う')).toBe(
    '$f(x) = x^{**2**}$ を使う',
  )
})

test('数式の中の [..](..) をリンクとして剥がさない', () => {
  expect(memoPreview('タイトル\n$[a](b)$ の記法')).toBe('$[a](b)$ の記法')
})

test('数式の外の強調は今までどおり剥がす', () => {
  expect(memoPreview('タイトル\n$x^*$ は **重要** だ')).toBe(
    '$x^*$ は 重要 だ',
  )
})

test('エスケープした \\$ (通貨) は数式の区切りにしない', () => {
  // \$100 と \$200 を数式と誤認すると、間の *強調* が数式内扱いで残ってしまう
  expect(memoPreview('タイトル\n\\$100 と \\$200 の *差額*')).toBe(
    '\\$100 と \\$200 の 差額',
  )
})

test('ブロック数式 ($$...$$) の中身はプレビューに出さない', () => {
  const memo = 'タイトル\n前置き\n$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$\n結び'
  expect(memoPreview(memo)).toBe('前置き\n結び')
})

test('行内の $$...$$ もその部分だけ落とす', () => {
  expect(memoPreview('タイトル\n式 $$E=mc^2$$ の後')).toBe('式 の後')
})

test('打ち切りが数式の内側に落ちるときは数式ごと落とす', () => {
  // 200 字の境界が $...$ の中に来ると「$E=1」のような切れ端が残るので、
  // その数式の開始 $ の手前で切る
  const filler = 'あ'.repeat(MEMO_PREVIEW_MAX_LENGTH - 5)
  const preview = memoPreview(`タイトル\n${filler} $E=100\\,\\mathrm{V}$`)

  expect(preview.endsWith('…')).toBe(true)
  expect(preview).not.toContain('$')
})

// レビュー指摘の回帰テスト (docs/69 §5 の割り切りと修正)

test('別々の行の $ 同士を数式の対にしない (通貨の $ が行を跨いで化けない)', () => {
  const preview = memoPreview('タイトル\n入力は $5 まで\n出力は $12 まで')
  expect(preview).toBe('入力は $5 まで\n出力は $12 まで')
})

test('リンク URL の中の数式を消しても、後続の数式の復元がずれない', () => {
  // URL ごと消えた数式の退避印で復元が 1 つずれ、$E=100$ の場所に
  // URL 内の $x$ が現れる事故の再発防止
  expect(
    memoPreview('タイトル\n[データシート](https://ex.com/?q=$x$) の $E=100$ 参照'),
  ).toBe('データシート の $E=100$ 参照')
})

test('本文に元から居る退避印の文字 (U+FFFC) が数式の位置をずらさない', () => {
  // PDF や Word からの貼り付けに混ざる不可視文字。捨てるだけで、
  // 数式が別の場所へ移ったり消えたりしない
  expect(memoPreview('タイトル\n図￼ の式 $E=100$')).toBe('図 の式 $E=100$')
})

test('行の途中の $$x$$ はその部分だけ落とし、行の残りは保つ', () => {
  expect(memoPreview('タイトル\nオームの法則 $$V=IR$$ の詳細')).toBe(
    'オームの法則 の詳細',
  )
})

test('bash フェンスの中の $$ (プロセス ID) をブロック数式と誤認しない', () => {
  const memo = [
    'タイトル',
    '```bash',
    'echo $$ > pid',
    '```',
    '説明の文',
    '```bash',
    'kill $$',
    '```',
  ].join('\n')
  // フェンスの中身も間の散文もそのまま残る
  expect(memoPreview(memo)).toBe('echo $$ > pid\n説明の文\nkill $$')
})

test('散文の途中の対にならない $$ はただの文字として残す', () => {
  expect(memoPreview('タイトル\n予算 $$ 未定')).toBe('予算 $$ 未定')
})

test('プレビューの頭から長い数式が始まっても本文が空にならない', () => {
  // 切り戻しで cut が 0 になると「…」だけになるので、従来位置で切る
  const longMath = `$${'x+'.repeat(150)}x$`
  const preview = memoPreview(`タイトル\n${longMath}`)
  expect(preview.length).toBeGreaterThan(10)
  expect(preview.endsWith('…')).toBe(true)
})

test('閉じ側が \\$ しか無い式は切り出さず生のまま出す', () => {
  // $p = 5\$/個$ を途中で切って KaTeX に渡すより、生で見せる方が安全
  expect(memoPreview('タイトル\n単価 $p = 5\\$/個$ の計算')).toBe(
    '単価 $p = 5\\$/個$ の計算',
  )
})

// ページの区切り (docs/74-ページ計画.md §3)。要約と同じ判断 (isStructureLine)
// を通すので、カードの本文プレビューにも "---" の文字を出さない
test('ページの区切り行はプレビューに出さない', () => {
  expect(memoPreview('タイトル\n\n本文A\n\n---\n\n本文B')).toBe('本文A\n本文B')
})
