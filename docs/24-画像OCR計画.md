# 画像OCRの設計 (Ver2.x)

memo に挿入した画像の文字をクライアントサイドで OCR し、
**画像の直後に引用ブロックとして挿入**する。memo 本文に入るので
PGroonga の全文検索がそのまま効き、誤認識は保存前に人間が直せる。
ここでは設計判断を残す。

前提の調査: ワークスペース側 `41-QR-search/docs/10-画像OCR調査メモ.md`
(エンジン比較・検索対象化方式・日本語優先の3方式)。
**このメモは計画のみ。実装はまだ行わない。**(2026-07-18)

## 1. 方針: クライアントで OCR し、結果は memo が正本

導線の全体像:

```text
編集ページで画像を挿入
  → 画像リンクを即挿入 + 直後に「> (OCR処理中…)」プレースホルダ
  → Web Worker で OCR (ブラウザ内完結。サーバに画像を再送しない)
  → プレースホルダを引用ブロックの認識結果で置換
  → ユーザーが誤認識を直して「更新」
  → memo に入った時点で全文検索の対象になる
```

- **結果の正本は memo 本文**。tags / props と同じく「派生情報は memo から」
  の設計に合わせ、DB に OCR 専用列は作らない
- 書誌自動取得 (docs/13) と同じ「**待たない**」流儀。挿入も編集も
  ブロックせず、結果は届いたら後から載る

## 2. エンジン: PaddleOCR 公式ブラウザ SDK + 正規化表 (②方式)

- モデルは **PP-OCRv5 の統合 mobile モデル** (det 4.8MB + rec 16.7MB)。
  onnxruntime-web (WASM、対応端末では WebGPU) でブラウザ内実行
- ライブラリは公式ブラウザ SDK
  [@paddleocr/paddleocr-js](https://www.npmjs.com/package/@paddleocr/paddleocr-js)
  (Apache-2.0)

### 縦書き対応 (2026-07-18 に差し替え)

当初は [ppu-paddle-ocr](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr)
を使っていたが、**日本語の縦書きがほぼ読めなかった**。切り分けの結果:

- モデルの問題ではない。同じ PP-OCRv5 を使う公式デモでは実画像の縦書きが読めた
- 原因は **SDK 側のパイプライン**。ppu-paddle-ocr は検出した矩形をそのまま
  認識モデルに渡すだけで、公式パイプラインにある
  「**縦横比 1.5 以上のクロップは 90 度回してから認識**」が無い。
  認識モデルは横一行を前提にしているので、縦長の列を渡すと潰れて全滅する

公式 SDK はこの回転を実装済み (`crop.ts`) なので、そちらへ乗り換えた。

- **読み順は自前で組む**。`predict()` が返す items は検出器の出力順であって
  読み順ではない。`src/lib/ocr/orderOcrItems.ts` で
  「縦長の箱が多数派なら縦書き」と判定し、縦書きは列を右→左・列内を上→下、
  横書きは行を上→下・行内を左→右に並べ替える
- **textline orientation は使えない**。公式 SDK の npm 版 (0.4.2) では
  `use_textline_orientation` が "config will be ignored for now" 扱いで
  未実装 (`unsupportedFeatures` に入る)。上下反転の列があると弱いはずだが、
  実測では縦書きが正しく読めているので今は足りている
- **日本語優先は後処理で実現する**: 統合モデルは中国語コーパスの影響で
  「単→单」「類→类」のような簡体字コードポイントを出すことがある。
  **簡体字/繁体字→日本語新字体の正規化表**を認識結果に 1 段かませる
- 旧世代の日本語専用モデル (PP-OCRv3 japan、辞書が日本語のみで混入ゼロ)
  は対抗案だったが、**まずは最新統合モデル + 正規化表で試す**(採用判断)。
  スパイク (§7 Phase 0) で混入率が想定より高ければ専用モデルに切り替える
- 「冷」のような日中同一コードポイントの字形差はフォント表示の問題であり、
  本アプリ (日本語ページ) では正しく表示される。OCR の誤りではない

## 3. モデルの配布: ローカル同梱 + 遅延ロード

- zxing-wasm と同じく **`scripts/` のコピースクリプトでローカル同梱**し、
  CDN に依存しない (PWA・オフライン方針と整合)
- **モデルの自前配布は必須**であって好みの問題ではない。SDK の既定は
  百度の CDN (`paddle-model-ecology.bj.bcebos.com`) から直接取るが、そこは
  **Access-Control-Allow-Origin を返さずブラウザから CORS で弾かれる**
  (実機で確認)。`scripts/fetchPaddleOcrModels.mjs` が `public/paddle-ocr/` へ
  落とし、`ocrService.ts` が同 URL を指す。
  モデル名は tar 内 `inference.yml` の `model_name` と一致が必要
- モデル (数 MB) はページロードでは読まず、**初回の OCR 実行時に遅延ロード**。
  Service Worker キャッシュで 2 回目以降は即時
- 初回は「準備しています (初回のみ)」の表示を出す

## 4. エディタ統合

- **挿入フォーマットは引用ブロック**。OCR 由来と一目で分かり、
  直しやすく、検索も普通に効く

  ```markdown
  ![](/api/images/xxx.jpg)

  > 冷却ファン 12V 0.1A
  > DC FAN 40mm
  ```

- 処理中は `> (OCR処理中…)` を置き、完了時に CodeMirror の位置追跡で
  置換する (ユーザーが打鍵中でも正しい場所に入る)
- **後から OCR**: 編集ツールバーに「OCR」ボタン。カーソル位置の画像記法を
  対象に `/api/images/<name>` を fetch して実行。
  **挿入時 OCR と同一関数に集約**する (経路が 2 つ、処理は 1 つ)
- 失敗・0 文字のときは黙らない: 「文字が見つかりませんでした」を明示して
  プレースホルダを除去する
- 再 OCR で引用が二重になったら手で消す (個人アプリなので KISS)

## 5. 検索

- memo に入るため**検索側の実装はゼロ**
- 検索結果一覧の「タイトル + 3 行」要約に OCR テキストが混ざる件は、
  まず許容して様子を見る。邪魔なら要約側で引用行をスキップする

## 6. テスト

- エンジン本体はモックし、**挿入ロジック (プレースホルダ置換・位置追跡) と
  正規化表**をユニットテストする
- 認識精度そのものはテストではなく Phase 0 のスパイクで実画像確認

## 7. 実装フェーズ

- **Phase 0: スパイク (残: 実機で要確認)**
  - 実画像 (部品ラベル・紙面の写真) で統合モデルの精度と簡体字混入率を実測
  - アップロード時圧縮後の画像で精度が足りるか
    (足りなければ圧縮前の原画像で OCR してからアップロード)
  - iPhone の WASM 実行速度とメモリ
- **Phase 1: OCR 基盤 (実装済み)** — `@paddleocr/paddleocr-js` +
  `onnxruntime-web`、ort wasm の自前配布
  (`scripts/copyOnnxWasm.mjs` → `public/onnxruntime/`)、モデルの自前配布
  (`scripts/fetchPaddleOcrModels.mjs` → `public/paddle-ocr/`)、
  正規化表 (`src/lib/ocr/normalizeJapanese.ts`)。Web Worker は未 (下記)
- **Phase 2: 挿入時 OCR (実装済み)** — 画像挿入後にプレースホルダを差し込み、
  `ocrImageToQuote` で認識 → 引用ブロックに置換。処理中/初回 UI、
  0 文字・失敗時のメッセージ (`MemoEditorInner.tsx`)
- **Phase 3: 後から OCR (実装済み)** — ツールバー「画像をOCR」ボタン。
  カーソル近傍の自前画像を取り直して OCR (Phase 2 と同一関数 `ocrIntoDoc`)

### 実装の構成 (2026-07-18)

| ファイル | 役割 | テスト |
| --- | --- | --- |
| `src/lib/ocr/normalizeJapanese.ts` | 簡体字/繁体字→新字体の正規化 (②) | あり |
| `src/lib/ocr/ocrQuote.ts` | 引用整形・プレースホルダ・画像特定 | あり |
| `src/lib/ocr/orderOcrItems.ts` | 読み順 (縦書き右→左 / 横書き上→下) | あり |
| `src/components/ocr/ocrService.ts` | 公式 SDK 遅延ロード・認識 | 実機 |
| `src/components/MemoEditorInner.tsx` | エディタ結線 (挿入時/後から) | — |
| `scripts/copyOnnxWasm.mjs` | ort wasm を自前配布 | — |
| `scripts/fetchPaddleOcrModels.mjs` | 認識モデルを自前配布 | — |

検証済み: 型チェック・eslint・`next build`・ユニットテスト (801 通過)。

**実機 E2E (2026-07-18)**: dev サーバ + Playwright で編集画面に画像を注入し、
挿入時 OCR を実行して確認した。

- 縦書き (3 列の印刷体): `電子部品の在庫整理` / `抵抗器と蓄電器の箱` /
  `冷却装置は棚の上段` を**列の順序も文字も誤りなく**認識
- 横書き (3 行): `冷却ファン12V0.1A` / `DC FAN 40mm 在庫3個` /
  `抵抗器 10kΩ1/4W` を正しく認識 (空白の有無だけ原文と差がある)
- 初回はモデル 21MB のロードで待つが、2 枚目以降は数秒
- コンソールに出る onnxruntime の `Removing initializer ...` は無害な警告

### ビルド上の注意 (Turbopack)

公式 SDK には**ブラウザでは通らない分岐**が残っており、Turbopack が静的解析で
追いかけて `next build` を落とす:

- 同梱 OpenCV.js (Emscripten) の Node 判定内 `require("fs")`
- 同梱 worker アセットが探す `ort.bundle.min.mjs`

どちらも実行時には踏まない (worker モードを使わない) ので、`next.config.ts` の
`turbopack.ignoreIssue` で SDK 配下の未解決を無視する。`path` は **glob ではなく
RegExp** で書く必要があり、範囲も `dist/assets/` に絞ると OpenCV.js
(SDK の node_modules にネスト) が漏れて落ちる。

### 既知の未了 (次に詰める)

- **Web Worker 化**: 現状はメインスレッド実行 (処理中は UI に出す)。
  公式 SDK は `worker: true` を持つので、重い画像で固まるようならそれに乗る
- **正規化表**: 実画像で出た簡体字を `normalizeJapanese.ts` に追記していく
  (E2E で使った印刷体では混入なし)
- **上下反転の縦書き列**: textline orientation が SDK 未実装なので弱いはず。
  実害が出たら SDK の対応を待つか、自前で列画像を反転して再認識する

## 9. iPhone 対策: メモリと下書き保護 (2026-07-18)

実機報告: PC Chrome では OCR できるが、iPhone Chrome では
「OCR モデルを準備しています…」の後に**エディタの内容が消える**。

診断: iOS WebKit のタブメモリ上限。OCR の初期化は SDK (OpenCV.js 内蔵) +
onnxruntime wasm + モデル 21MB を一度に抱え、さらにアップロード画像は実質
原寸保存 (webp 上限 16383px のみ) のため iPhone の高画素写真がそのまま
OpenCV の行列に展開される。上限を超えると WebKit がタブごと再起動し、
**未保存の編集内容が失われる** (「クリアされた」ように見える)。

対処 (3 点):

1. **OCR 入力の縮小**: 長辺 2048px を超える画像は縮小してから認識する
   (`ocrService.ts` の `MAX_OCR_SIDE`)
2. **検出段は長辺 960 に制限**: SDK 既定 (短辺 64・上限 4000) は大きな文字で
   検出が細切れになるのを実測。PP-OCR の伝統的既定 960/'max' を predict
   パラメータで指定。認識段は縮小前の切り抜きを使うので画質は落ちない
3. **backend を wasm に固定**: iOS WebKit の WebGPU という変数を消す。
   画像検索 embedder の「WASM が基準性能」方針に合わせる

加えて**下書き保護** (`src/lib/memoDraft.ts` + `MemoEditor`): 編集中の本文を
localStorage に退避 (400ms debounce、ノートごとに `draftKey` = itemNo)。
再訪時にサーバ値と食い違う下書きがあれば復元して知らせ、「下書きを破棄」で
保存済みの本文に戻せる。保存が成功すると次回訪問時に下書きは自動で掃除される。
これでタブがどんな理由で落ちても編集内容は失われない。

タブ再起動そのものの根絶は端末依存で確約できない (初期化ピークは残る)。
再発するなら次の一手は PP-OCRv6_tiny への切り替え (モデル数分の一、精度は
要実測)。

### 9-1. OCR の後に画像検索が落ちる → OCR を Worker へ (2026-07-19)

実機報告: スキャン → OCR まで通った後、続けて**画像検索**を開くとメモリ不足で
モデルを読み込めない。

診断: OCR の singleton (`servicePromise`) は OpenCV.js と onnxruntime-web の
wasm ヒープを抱えたまま **realm に居座り続ける**。SPA 遷移では realm が
変わらないので、編集画面を離れても解放されない。そこへ画像検索が別の
onnxruntime + DINOv2 を積むため上限を超える。画像検索側は閉じるときに
`worker.terminate()` しており行儀が良いので、残っていたのは OCR 側だけだった。

#### 失敗した一手: dispose() で解放する (v0.18.0・撤回済み)

最初は SDK の `dispose()` (det/rec の ORT セッションを release) を編集画面の
unmount で呼ぶ方式を入れた。**これは効かないどころか悪化した**。実機の体感は
「以前よりメモリーエラーになりやすい」で、ログにも OOM が並んだ。

理由: `WebAssembly.Memory` は grow しかできない。`dispose()` はヒープの
**内側**でメモリを返すだけで、タブの占有量は 1 バイトも減らない。一方で解放の
たびに次の OCR がセッションを作り直すため、断片化した領域を再利用できずヒープが
かえって伸びる。**解放の呼び出し回数を増やした分だけ悪くなる**。

同時に入れた「embedder を 1 回目から WASM で組む」(`spawn(true)`) も撤回した。
WebGPU ならモデルの重みが GPU 側に載る可能性を潰し、両方の試行が wasm ヒープを
食う経路になっていた (ログでは 2 回とも `wasm` で OOM)。

#### 採った手: OCR を Web Worker へ移して terminate する

realm ごと捨てるのが**唯一メモリを OS へ返す方法**なので、OCR の実体を
`ocrWorker.ts` に移し、`ocrService.ts` はメインスレッド側の窓口 (Worker を 1 本
抱えて要求と応答を対応づけるだけ) にした。

- `disposeOcr()` は `worker.terminate()`。呼ぶのは編集画面の unmount
  (`MemoEditorInner`) と、**画像検索モーダルを開いた時点** (`ImageSearchModal`)。
  後者は「落とされないまま来た」経路が 1 つでもあれば元の症状が出るので、
  メモリを要る側からも要求しておく保険。`ImageSearchModal` では
  **`useImageEmbedder` より前**に置くこと (effect は登録順に走るので、後ろだと
  埋め込みモデルを積み始めてから解放することになる)
- 走っている OCR は待たない。呼ぶのは編集画面が閉じた後か画像検索の直前で、
  どちらも結果の行き先が無い。待っている呼び手には理由を伝えて落とす
- 副次効果: 認識中もメインスレッドが空くので、「認識中は進捗もアニメも
  描画されない」制約が外れた

**SDK の worker モード (`worker: true`) を使わない理由**: あちらは自前 `fetch` を
受け取れず、モデル DL の進捗 % が出せなくなる。モデル資産は
`Cache-Control: no-cache` かつ ETag 無しで配られるため、「メインスレッドで
先読みしてキャッシュを温める」逃げ道も使えない (21MB を二重取得することになる)。
自前 Worker なら Worker 内の `fetch` をそのまま渡せて、% は postMessage で
中継できる。

**Worker 化に必要だった 2 つの shim** (`ocrWorker.ts` 冒頭): SDK の非 Worker
ビルドは DOM を前提にしており、素の Worker では動かない。実測で踏んだのは 2 つ:

1. `document.createElement("canvas")` — `bitmapToSourceMat` が認識のたびに呼ぶ。
   `OffscreenCanvas` を返して解決 (SDK 自身の worker-entry も同じ変換を
   OffscreenCanvas で行っており、同梱 OpenCV は imread で OffscreenCanvas を
   受け付ける)
2. `HTMLImageElement` / `HTMLCanvasElement` — OpenCV.js の imread が
   `instanceof` を先に見るため、未定義だと ReferenceError。渡すのは常に
   OffscreenCanvas なので、素の class を置いて false にすれば素通りする

SDK を上げるときはこの 2 点が生きているか確認すること。壊れると Worker 起動
直後に ReferenceError で落ちるので、実機を待たず編集画面の OCR 1 回で分かる。

**ローカル実測 (Chrome, 2026-07-19)**: 挿入時 OCR が Worker 内で成功し
(`ABC-1234` / `TEST OCR` を取得、進捗 % も従来どおり表示)、編集画面を離れると
Worker は 0 本になった。戻って 2 回目の OCR も成功 (`SECOND-99`)。

**iPhone 実機 (v0.18.1, 2026-07-19)**: スキャン → OCR → 画像検索が OOM なしで
通ることを確認 (/logs: OCR Worker 破棄 → 画像検索モデル準備完了 2.5 秒、失敗ゼロ)。
**元の報告の症状はこれで解消。**

### 9-2. Worker で組めない環境がある → 三段構え (2026-07-19)

v0.18.1 を Windows Chrome で使うと、OCR が
`Can't create a session. failed to allocate a buffer of size 16534782` (認識
モデルの 16.5MB を確保できない) で落ちる報告。/logs の診断イベントによると
この環境は **JS ヒープ上限 1120MB・WebGPU アダプタ無し** (通常の x64 Chrome は
上限 ~4GB) の constrained な renderer で、OpenCV + onnxruntime を同居させる
Worker realm がアドレス空間を確保できない。同じ機械のメインスレッドでは
v0.18.0 まで同じ構成が動いていた。ローカルの本番ビルド (通常の Chrome) では
再現しない。

対処: `ocrService` を三段構えにした。

1. **Worker で初期化** (本命。iPhone・普通の PC はここで終わる)
2. 初期化に失敗したら **Worker を 1 度だけ作り直して再試行** (embedder と同じ。
   待っている要求は保持して新しい Worker に出し直す)
3. それでも失敗したら **メインスレッドで実行** (`ocrMainFallback.ts`)。以後の
   OCR は直接こちらへ (ラッチ)。代償として、この環境だけ v0.18.0 以前の
   「wasm ヒープの居座り」が戻る (realm を捨てられないため)。それでも
   「OCR が使えない」よりよい

構成: パイプラインの組み立て (`createOcrService` / `ocrWithService`) を
`ocrPipeline.ts` に共通化し、Worker (shim + メッセージ処理) と
メインスレッド・フォールバック (singleton) がそれぞれ薄く包む。診断イベントは
`[OCR] 読み込み失敗 → Worker を作り直して再試行` と
`[OCR] Worker で組めないためメインスレッドで実行 (フォールバック)` が増えた —
/logs にこれが出る端末は constrained 環境ということ。

注意: 各段でモデル 21MB を取り直す (モデル配布は `Cache-Control: no-cache` で
ETag が無く、ブラウザキャッシュに乗らないため)。フォールバックまで落ちる
環境では最大 63MB の取得になる。頻発するならモデル配布に ETag/immutable を
付ける改善があるが、まずは動くことを優先した。

#### 実機の答え合わせ → 復旧に待ちを入れる (v0.18.2 の実測)

v0.18.2 の実機 (同じ Windows) で三段構えは設計どおり遷移したが、**フォール
バックのメインスレッドまで同じ 16.5MB の確保に失敗**した。/logs の時系列では
6 秒間に realm を 3 つ (Worker ×2 + メインスレッド) 渡り歩いている。
terminate した realm の wasm メモリの回収は非同期なので、**失敗直後に次の
realm で OpenCV + ORT を積むと、死んだ realm のぶんがまだ返っておらず同じ
失敗を繰り返す**。v0.18.0 のメインスレッド実行が動いていたのは、こういう
連続確保が無かったから。

対処: 復旧の各段に待ちを入れた (`RESPAWN_DELAY_MS` = 1 秒、
`FALLBACK_DELAY_MS` = 3 秒)。失敗した Worker は**即 terminate してから**待つ
(回収を先に始めさせる)。待ちの間に来た OCR 要求は積むだけにして、復旧後に
まとめて出し直す。画面を離れたら復旧待ちも取り消す (誰も待っていないのに
モデル取得が始まるのを防ぐ)。

あわせて直した UI バグ: OCR がエラーで終わっても「OCR モデルを準備して
います…」のバナーが残り続けていた (エラーと並ぶと「待てば直る」と誤解される)。

それでも駄目な場合、この機械は renderer のメモリがそもそも足りていない
(JS ヒープ上限 1120MB は通常の x64 Chrome の 1/4)。Chrome が 32bit 版で
ないか (chrome://version)、物理メモリの空きが無いか、を疑う段になる。

**確定 (2026-07-19)**: chrome://version で **Chrome 150 (公式ビルド) (32 ビット)**
と判明 (OS は 64bit の Windows 11)。32bit プロセスはアドレス空間が約 2GB しか
なく、OpenCV + ORT の wasm 連続確保が構造的に破綻する。根治は 64bit Chrome への
入れ替え (google.com/chrome から入れ直せばプロファイルはそのまま 64bit に
上書きされる)。上の三段構え + 待ちは、32bit のままでも OCR を使えるように
する保険として残す。

## 8. 見送り (必要になったら)

- 既存全画像の一括バッチ OCR (個別ボタンで足りる。要るなら Node 側で)
- `<details>` 折りたたみ挿入 (rehype-sanitize が通すか未確認。引用で開始)
- 再 OCR 時のマーカー置換 (手で消せば済む)
- デコード時の文字集合制限 (③方式。②で足りるなら不要)
