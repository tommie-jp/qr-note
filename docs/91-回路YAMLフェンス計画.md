# 回路 YAML フェンス計画

` ```circuit ` フェンス (YAML) を回路図として描けるようにする。
変換は [circuit-fence](https://github.com/tommie-jp/circuit-fence)
(VS Code 拡張として作った処理系) のコアに任せ、
TeX → SVG は既存の回路図パイプライン (docs/68 / 70 / 85) にそのまま乗せる。

現行の ` ```circuitikz ` フェンス (素の TeX) は**そのまま残す**。
既存ノートは全部そちらで書かれており、YAML 側は上位互換ではない
(TeX を直に書きたい図もある)。2 つは別のフェンス言語として共存する。

## 0. なぜ

` ```circuitikz ` の不満は 2 つ (circuit-fence を作った動機と同じ)。

1. 定型 4 行・座標決め打ち・`\coordinate` の手打ちが面倒
2. 間違えても「描画されない」だけで、**どの行が悪いか分からない**
   (TeX のログから `l.12` を拾って見せてはいるが、行番号は生成 TeX のもの)

circuit-fence は番地 (`R1: resistor a1 a3 10k`) で置けて、読めなかった行を
**YAML の行番号つき**で返す。LLM に書かせて自己修正させる用途ではここが効く。
描画品質は同じ circuitikz なので、見た目は現行と揃う。

## 1. 取り込み方 — npm pack の tarball を vendor/ に置く

circuit-fence は npm レジストリに公開していない (VS Code 拡張が本体)。
`exports` に `circuit-fence/core` (ESM / CJS / 型定義) が生えており、
`npm pack` の tarball で渡せる。

- [vendor/circuit-fence-0.2.0.tgz](../vendor/circuit-fence-0.2.0.tgz) に置いた。
  使うときに `"circuit-fence": "file:vendor/circuit-fence-0.2.0.tgz"` を
  dependencies へ足す
- git 依存 (`github:`) にしない: Docker のビルダ (node:24-slim) に git が無く、
  `npm ci` が落ちる。tarball ならビルド文脈の COPY だけで済む
- 更新は circuit-fence 側で `npm pack` して置き換える (ファイル名に版が入るので、
  package.json の指定も一緒に変わる)

### 最初に置いた 0.1.0 は差し替えた (2026-08-30)

**同じ 0.1.0 の名前で中身が 2 つあった**。最初の tarball は 2026-08-27 の
手渡しで、その後 circuit-fence 側に矢 (`i=` / `v=`)・ラベル (`l=`)・計器
(`wattmeter` / `galvanometer` / `detector`)・素の線 (`short`)・直線の注釈が
入っている。**書き溜めた図 57 枚のうち 49 枚が古い tarball ではコンパイル
エラーになる**と実測したので、向こうで `v0.2.0` をタグしてから作り直した。

版で見分けが付かないと、§2 のキャッシュキー (`VERSION` を混ぜる) が古い SVG を
当てても気づけない。**tarball を差し替えるときは必ず向こうの版も上がっている**
という前提で書いてよい (circuit-fence 側の doVersion.sh がタグと
`data-circuit-fence` の刻印まで揃える)。

確認済みのこと (2026-08-30、0.2.0 の tarball を別プロジェクトへ
npm install して実測):

- ESM / CJS どちらでも読める。`compileCircuit` が TeX と行番号つきエラーを返す
- tsc の型解決が通る (bundler / nodenext、skipLibCheck なし) — 2026-08-27 に確認
- 依存として node-tikzjax `^1.0.5` が付いてくる。こちらの指定と同じなので
  dedupe されて 1 つになる想定 (**lockfile で要確認** — 二重に入ると
  jsdom ごと 87MB 増える)
- 書き溜めた図 57 枚がエラーゼロで通る (0.1.0 では 49 枚が落ちていた)

### Dockerfile の依存レイヤーに vendor/ の COPY が要る

`.deps/` の写し (docs/80 §S1) には `file:vendor/...` の指定が**そのまま**写る
(writeDepsManifest.mjs が潰すのは自分の版番号だけ)。依存レイヤーで
`npm ci` が tarball の実体を読むので、`COPY .deps/...` の直後に
`COPY vendor ./vendor` が要る。

Dockerfile の「この層に他のファイルを足さないこと」への例外になるが、
これは正当: vendor/ の中身が変わる = 依存の実体が変わる、なので
そのとき npm ci が走り直すのは狙いどおり。逆にここに COPY が無いと
npm ci が ENOENT で落ちる (キャッシュを黙って壊す類の失敗ではない)。

## 2. 描画の流れ — compile は同期、TeX → SVG は既存の 1 本

circuit-fence のコアは「YAML → 検証 → circuitikz TeX」までが
**同期の純関数** (DOM も Node API も使わない)。重いのは TeX → SVG だけで、
そこは既存の renderCircuit (直列キュー・10 秒 timeout・子プロセス) を使う。

```text
YAML ソース
  → compileCircuit(source)             … 同期・純関数。エラーは YAML の行番号つき
  → tex を renderCircuit 系へ          … 既存の子プロセス描画
  → SVG 後処理 (すべて core の純関数)
      applyNotes  … 注釈の日本語を SVG に差し込む (TeX には渡っていない)
      recolorSvg  … テーマの塗り替え
      finishSvg / markSvg … 仕上げと data-circuit-fence 属性
  → assertSafeCircuitSvg → DB キャッシュ (circuit_svgs)
```

決めどころ:

- **プリアンブルは二重にしない**。compileCircuit の返す TeX は
  `\usepackage{circuitikz}` から `\end{document}` までの**完全な**
  node-tikzjax 入力。circuitikz.ts の PREAMBLE / withCircuitEnvironment を
  通さず、そのまま子プロセスへ渡す口を分ける。OPAMP_FONT_FIX も不要
  (circuit-fence は `op amp` を使わず `plain amp` + 手書き ± に置換済み —
  cmmib5 が無い問題を向こうも踏んでいて、回避が織り込まれている)
- **キャッシュキーは版を 2 つ混ぜる**。`circuitHash` と同じ形で、
  version に `RENDERER_VERSION` + circuit-fence の `VERSION` (export されている)
  をつなげる。コンパイラが変われば同じ YAML でも TeX が変わるため
- **後処理まで済ませた SVG をキャッシュする**。テーマは `auto`
  (線が currentColor になり、明暗どちらでも読める) で描けば 1 枚で足りる。
  注釈の `<text>` は assertSafeCircuitSvg の許可リスト内に収まる — 図 57 枚を
  描いて通したところ**全部通過した** (2026-08-30 実測)。出るのは `text` /
  `fill` / `text-anchor` / `font-family` / `font-size` / `xml:space` だけで、
  外部参照も `url()` も無い。**実装時にもテストとして残す**
- **コンパイルエラーは TeX まで行かずに返せる**。CircuitResult の
  `{ error, texLog }` に「N 行目: 理由」を整形して流せば表示側は無改修でも
  動くが、行番号つきの利点を出すなら専用の表示が要る (§4)
- **`notices` をどう扱うか決める**。`compileCircuit` の戻り値には `errors` の
  ほかに `notices` (図は描けるが伝えたいこと。行番号つき) がある。出さないなら
  黙って捨てることになるので、§4 のエラー表示と一緒に決める

## 3. フェンス言語の名前 — 定数の整理が先

fenceLanguages.ts の `CIRCUIT_LANG` は今 `'circuitikz'` を指している。
新フェンスは `'circuit'` なので、先に定数名を実体に合わせて直す:

- `CIRCUITIKZ_LANG = 'circuitikz'` (rename。使用箇所は機械的に追える)
- `CIRCUIT_LANG = 'circuit'` (新設) — **既存の名前を新しい意味で使い回す**
  ので、rename を別コミットにして混ざらないようにする
- 紛らわしければ `CIRCUIT_YAML_LANG` のような別名でもよい。決めるのは実装時

`RENDERED_LANGS` に足す (linter の「打ち間違いで黙ってコードブロック」警告と
補完の対象になる)。`circuit` と `circuitikz` の編集距離は 3 なので、
互いに打ち間違い扱いされることはない (suggestFenceLang の上限は 2)。

## 4. 触るところ

docs/83 (健康フェンス) が新フェンス追加の前例。同じ場所を触る。

| 場所 | 何をするか |
| --- | --- |
| fenceLanguages.ts | §3 の定数整理 + `RENDERED_LANGS` へ追加 |
| circuitFences.ts | 抽出を言語引数つきにするか、並びの関数を足す |
| circuitikz.ts | 完全な TeX 文書をそのまま描く口 (プリアンブルを足さない) |
| circuitCache.ts | compile → render → 後処理 → キャッシュの circuit 版 |
| api/circuits/route.ts | 編集ライブプレビュー用に言語も受ける (docs/70 §7) |
| MarkdownView.tsx | `circuit` フェンスの分岐。エラーは行番号つきで図の下に |
| circuitThumbs.ts | 一覧サムネの対象に circuit フェンスも含める (docs/68) |
| offline (syncItems / item) | 先読みの対象に含める (docs/65) |
| scripts/backfillCircuits.ts | 一括描画の対象に含める (docs/68 §6) |
| editor/fenceBlocks.ts | CodeMirror のブロック表示。中身は YAML としてハイライト |

1 メモあたりの枚数上限 `MAX_CIRCUITS_PER_MEMO` (8 枚) は、
2 言語の**合算**で数える — 上限の理由は「1 回の表示で走る TeX の総量」
なので、言語が増えても数えるものは 1 つのまま。

## 5. やらないこと (最初は)

- ネットリスト表示 (compileCircuit は返してくるが、ノートの読み手には過剰)
- `--emit-tex` 相当 (日本語の値を通す書き出し)。ノートでは注釈 (`notes:`) が
  日本語を通すのでまず足りる
- 既存 ` ```circuitikz ` ノートの移行。共存が前提で、書き換えない

## 6. 段取り

1. vendor/ + dependencies + Dockerfile の COPY (§1) — lockfile の dedupe を確認
2. compile → render → cache の 1 本 (§2) — 単体テストで注釈・テーマ・
   エラーの 3 経路を通す
3. 閲覧 (MarkdownView) と編集ライブプレビュー (api)
4. サムネ・オフライン・バックフィル
5. linter・補完 (fenceLanguages)
