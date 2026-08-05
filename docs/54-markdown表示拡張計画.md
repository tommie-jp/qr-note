# Markdown 表示拡張計画 (コードコピー・アラート・脚注・折りたたみ)

[MarkdownView.tsx](../src/components/MarkdownView.tsx) に読み取り専用の
表現・インタラクションを 4 つ足す。チェックボックスのクリック対応 (別計画) とは
独立して進められる。

4 つともサーバ状態を持たない (保存を伴わない) ため、`allowRotate` /
`allowSecretEdit` のような出し分け prop は不要で、ノート閲覧・公開ビュー・
docs ページ・印刷のすべてで共通に有効化できる。

## 1. コードブロックのコピーボタン

markdown 記法ではなくレンダラー側の機能。iPhone でコードブロックを範囲選択
するのは苦行なので、費用対効果がいちばん高い。依存追加もパーサ変更も無いため
最初にやる。

- `preOrDiagram` で素の `<pre>` に落ちる経路を `CodeBlock.tsx`
  (client component) に差し替え、右上にコピーボタンを重ねる。
  mermaid / circuitikz フェンスは図になるので対象外。
- コピー文字列は `readFence` と同様に子の文字列を連結して得る。ただし
  `readFence` は**言語なしフェンスで null を返す** (language- クラスが無い) ので、
  コピー用にはテキスト収集だけの共通ヘルパを切り出す。インラインコードは対象外。
- `navigator.clipboard.writeText()` を使う。**ボタンは常に出す** — 当初は
  `navigator.clipboard` が無ければ隠す案だったが、それを hydration 前に判定
  できず「mount 後にボタンが生えて画面が跳ねる」ことになる。押した時点で
  失敗として文言を出すほうが素直で、コードも短い (実装はこちら)。
  失敗時はボタンの下に短くエラーを出す (握り潰さず console にも残す)。
- 成功したらボタンを約 2 秒 ✓ 表示に変えて戻す。
- 印刷にボタンを出さない (`print:hidden`)。

テスト: クリックで clipboard mock に中身が渡ること・✓ 表示に変わること・
言語なしフェンスにも出ること・mermaid フェンスには出ないこと。

## 2. GFM アラート (コールアウト)

GitHub 互換の 5 種 (`[!NOTE]` `[!TIP]` `[!IMPORTANT]` `[!WARNING]` `[!CAUTION]`)。

```markdown
> [!WARNING]
> ここに注意書き。複数行も可
```

- **既製の remark-github-blockquote-alert は採らない** — SVG アイコン入りの
  HTML を生成するため、sanitize (svg 不許可) と衝突する。svg を許可リストに
  足すのは攻撃面の拡げ方として割に合わない。
- 代わりに自前の小さな remark プラグイン `remarkAlerts` を書く:
  mdast の blockquote の先頭段落が `[!NOTE]` 等で始まるものを見つけ、
  `hProperties.className = "alert-note"` を付与してマーカー行を取り除くだけ。
  非対応語 (`[!FOO]`) は普通の blockquote のまま素通しする。
- 表示は `components.blockquote` の差し替えで行う。className を見て
  アイコン + 色付き枠を React 側で組み立てる — sanitize 後に React が作る
  要素なので許可リストは要らない (AudioPlayer 等と同じ理屈)。
- sanitize には blockquote の `["className", /^alert-/]` だけ追加する。

記法は純粋な blockquote なので、GitHub・Obsidian でもそのまま通用する
(他レンダラーで開いても壊れない)。

テスト: 5 種の変換・マーカー行の除去・`[!FOO]` の素通し・
マーカーのみで本文が無い場合・blockquote ネスト。

## 3. 脚注

記法 (`[^1]` と `[^1]: 説明`) は remark-gfm に含まれていて既にパースされる。
問題は **id の衝突回避 (clobber) が二重に掛かって往復リンクが壊れる**こと:

- remark-rehype が脚注に `user-content-fn-1` のような id を生成する。
- rehype-sanitize も既定で id に `user-content-` を前置する (clobber)。
  二重に掛かると id が `user-content-user-content-fn-1` になり、
  href (`#user-content-fn-1`) と食い違ってジャンプが死ぬ。

方針: **prefix はどちらか片方に統一する**。rehype-sanitize 側を
`clobberPrefix: ""` にして remark-rehype 既定の `user-content-` を生かすのが
素直。生 HTML は無効なので本文から任意の id は書けず、id の出所は脚注
(と KaTeX) だけ — clobber を外しても衝突・乗っ取りの余地は無い。

- sanitize で `data-footnotes` 等の data 属性は落ちるが表示に必須ではない。
  脚注セクション見出し (既定 "Footnotes"、`sr-only` クラスが落ちて見える) は
  `remarkRehypeOptions` の `footnoteLabel` で「脚注」に差し替える。
- 実装はほぼ設定変更のみ。最初に現状の壊れ方をテストで固定してから直す。

テスト: 本文 → レンダリングで参照リンクの href と脚注 li の id が一致する
こと・戻りリンク (↩) の href と参照側 id が一致すること。

## 4. 折りたたみ (details)

長いノート・OCR の生テキスト・ログの格納用。4 つの中で唯一パーサに新依存
(remark-directive) が入るため最後にやる。

```markdown
:::details[長いログ]
ここは畳まれる。画像・コード・表など通常の markdown が使える
:::
```

- ラベルは remark-directive の仕様どおり `[タイトル]` 形式 (Docusaurus v3 と
  同じ)。省略時は「詳細」。
- 自前プラグイン `remarkDetails`: `containerDirective` の name=details を
  `<details>` に写し、先頭に `<summary>` を差し込む。中身は通常の markdown
  として描かれる。
- **remark-directive はそのまま使わない。** あれは text (`:語`) / leaf
  (`::語`) / container (`:::語`) の 3 つをまとめて有効にする。とくに text 記法は
  コロンの直後が英数字なら何でも拾うので、`型:int` や `時刻 12:30:45` といった
  何気ない本文まで構文として食われ、既定では中身だけ残した `<div>` になる —
  書いた本人には「なぜか消えた」としか見えない。
  - そこで `micromark-extension-directive` と `mdast-util-directive` を直接
    依存に持ち、**container のトークナイザだけ**を登録する
    (`remarkDetailsSyntax`)。構文として意味を持つのは `:::` で始まる行だけに
    なり、コロンを含む本文は一切触られない。
  - 知らない囲い (`:::tip` などを他所から貼った場合) は、**中身を Markdown の
    まま残し、囲いの行だけを文字として見せる**。原文まるごとを 1 つの文字に
    戻すと、中の強調やリンクまで潰れてしまう。
- `<details>` はネイティブに開閉するので client JS 不要 —
  MarkdownView が Server Component のままで済む。
- sanitize: defaultSchema (GitHub 準拠) は details / summary を許可している
  はず。**テストで確認し**、落ちるようなら tagNames に明示追加する。
- 開閉状態は保存しない (そのページ限り)。`{open}` 属性などの初期展開指定は
  必要になるまで作らない (YAGNI)。

テスト: 変換・ラベル省略時の既定・中身の markdown (コード・画像) が
描かれること・sanitize を通って details/summary が残ること・
details 以外の directive が素通しすること。

## 5. 実装フェーズ (TDD) — 実装済み

1. コピーボタン — `CodeBlock.tsx`。`readFence` は言語なしフェンスで null を
   返していたので、`lang: string | null` を返す形に変えて字下げコードにも出す
2. アラート — `remarkAlerts.ts` + `MarkdownAlert.tsx` + blockquote 差し替え
3. 脚注 — 壊れ方をテストで固定 → `clobberPrefix: ""` + `footnoteLabel`
4. 折りたたみ — remark-directive 導入 + `remarkDetails.ts`

一覧の要約 (`memoSummary` / `memoPreview`) も直した。さもないとアラートで
始まるノートの要約が「[!NOTE]」になる。

- 目印の語彙は `src/lib/markdownAlerts.ts` に単一ソースとして置き、表示側
  (`remarkAlerts`) と要約側の両方から読む (`fenceLanguages.ts` と同じ作法)。
  別々に持つと「詳細画面には `[!FOO]` と出るのに要約からは消える」といった
  食い違いが起きる。
- `:::` の行はコードフェンスと同じ扱いで飛ばす。ただし
  **`:::details[ラベル]` のラベルは残す** — 書き手が付けた見出しそのもので、
  捨てると要約に出るのが「折り畳んで隠したはずの 1 行目」になる。
- 脚注の参照 `[^1]` と定義行の目印も落とす。
- 判定は `isStructureLine()` に寄せて要約とプレビューで同じ行を選ばせる。

エディタ (CodeMirror) 側のツールバー挿入ボタンは今回の対象外 — 記法は手書きする。

## 6. 承知しておく制約

- **閉じた details は印刷に出ない**。困る場面が出たら印刷ビューだけ `open` を
  強制して描く (prop 1 つで済む)。
- エディタのプレビューではなく閲覧側の機能。CodeMirror 上では記法が
  そのまま見える (既存の mermaid 等と同じ)。
- 記法の互換性: アラート・脚注は GitHub / Obsidian 互換。`:::details` は
  directive 系 (Docusaurus / VitePress 等) のみで、GitHub に貼ると `:::` 行が
  ただの文字として見える (壊れはしない)。
- container のトークナイザは `micromark-extension-directive` の戻り値
  (`flow[58]` の 1 つ目) を取り出して使っている。依存を上げて形が変わったら
  取り出しに失敗するので、黙って素通しせず投げる (テストで固定済み)。
- コピーは secure context (https / localhost) でしか動かない。本番・開発とも
  そこに収まっているので実害は無い (外れた場合は押すと文言が出る)。
- 脚注の見出し「脚注」は remark-rehype が `sr-only` で置くため画面には出ない。
  代わりに wrapper 側の `[&_.footnotes]` で上に区切り線を引いている。
- 本文は最大 10,000 文字なので、どの機能も性能面の考慮は不要。
- チェックボックスのクリック対応 (別計画) とは独立。ただし「sanitize が
  `input` をどこまで許すか」の確認はあちらでも要るので、脚注フェーズで
  sanitize まわりを触るときに一緒に見ておくと二度手間にならない。
