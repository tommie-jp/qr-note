# tommie-fence 最新版への取り込み計画 (circuit・breadboard・perfboard・fence-kit)

計画日: 2026-10-13 / 状態: **完了 (v0.23.19 を 2026-10-13 に本番へ配布。§9)**

上流 ([tommie-fence](https://github.com/tommie-jp/tommie-fence)) が進み、QR Note が使っている
4 つの tgz が古くなった。版を上げるときに壊れるものと、先にやる作業を測って決める。

前例は [97-実体配線図フェンス計画.md](97-実体配線図フェンス計画.md) (tgz を vendor/ に置く) と
[99-フェンスGUI編集計画.md](99-フェンスGUI編集計画.md) (殻の取り込み)。
検討メモは `41-QR-search/docs/26-tommie-fence取り込み検討メモ.md`。

## 1. 結論

- **版上げそのものは小さい。** 型検査は通り、単体テスト 483 件のうち 469 件が通った。
  失敗した 14 件はテストの書き方の問題で、アプリの不具合ではない (§2)
- **先にやるのは本番のメモ 3 件の書き換え。** circuit-fence は 0.35.0 から旧い番地
  (`a1` `a1f5`) を読まずに断る。本番 (832 メモ) で旧い綴りの `circuit` フェンスを
  持つのは **3 メモ** (§3)
- キャッシュの描き直しは **3 図だけ**。`./doBackfill.sh circuits` の負荷は無視できる
- 新しい 6 つのフェンス (copper・vna・scope・spectrum・graph・logic) は**今回やらない** (§6)

## 2. 試した結果 (使い捨ての worktree で、4 つの tgz を差し替えて測った)

| 部品 | 今 | 最新 |
| --- | --- | --- |
| circuit-fence | 0.9.1 | 0.38.1 |
| breadboard-fence | 0.10.0 | 0.42.0 |
| perfboard-fence | 0.8.0 | 0.41.0 |
| fence-kit | 0.1.0 | 0.20.0 |

4 つとも上流 Release の `SHA256SUMS` で照合した。`npm install` と `npm run typecheck` は通る
(`fence-kit/shell` と各コアの `FenceEditor` の写しは一致している)。

テストの失敗 14 件の中身:

| 原因 | 件数 | 直し方 |
| --- | --- | --- |
| `circuit` のテストデータが旧い番地 (`a1 a3`) | 11 | `x,y` の綴りに書き直す |
| 殻の言語名が `breadboard` から正式名の `bread` に変わった | 1 | 期待値を `bread` にする |
| SVG に `clippath` が増えた (許可リスト `safeSvg.ts` には入っている) | 1 | 期待する要素の一覧に足す |

breadboard / perfboard の番地 (`a5 a10`) は**基板の穴の名前で、変わっていない**。直すのは
`circuit` フェンスの番地だけ。

## 3. 本番の調べ (2026-10-13、読み取り専用の SELECT)

| 項目 | 件数 |
| --- | --- |
| メモの総数 | 832 |
| `circuit` フェンスを持つメモ | **3** (item_no 1094・1095・1168) |
| `breadboard` / `bread` | 0 |
| `perfboard` / `perf` | 0 |
| `circuitikz` | 65 (TeX の素書き。番地の変更に無関係で、版の鍵も混ざらない) |

3 メモとも旧い綴りで書かれていて、0.38.1 は「`a3 は旧い綴りです。3,1 と書きます`」と断る。
上流の `migrateCircuitFences` (`circuit-fence/core`) で書き直すと、**3 メモとも `skipped` なしで
0.38.1 のエラーが 0 件になった** (変更は 11・29・10 か所)。

最初の厳密な正規表現は CRLF の行末を取りこぼして 0 件と出た。**数えるときは `\r?\n` を許す。**

## 4. 決め

| # | 決め | 理由 |
| --- | --- | --- |
| 1 | 4 つの tgz を同じ日の Release から取り、**同時に**上げる | `FenceEditor` の型が殻とコアの両方に写しで入っている (99 の決め 13) |
| 2 | 書き換えは**アプリの保存経路を通す** | `title` `tags` `props` などの派生列を作り直すため。SQL で `memo` だけを更新しない |
| 3 | 配布 → 書き換え → backfill の順 | 旧いアプリは新しい番地を読めず、新しいアプリは旧い番地を断る。**配布から書き換えまでの数分だけ 3 図がエラーになる**のは許す |
| 4 | 書き換える前の本文を残す | `before` を保存すれば、版を戻すときに元へ戻せる |
| 5 | 旧い綴りを読む期間は作らない | 上流も作っていない。3 件だけなので不要 |
| 6 | 記法ヘルプ `docs/メモ記法.md` の `circuit` の例を直す | 利用者が見る文書。旧い番地の例が 8 行ある |

## 5. 手順

1. 作業ブランチを切る (`chore/fence-0.38`)
2. `vendor/` の 4 つの tgz を差し替え、`package.json` を直して `npm install`
3. テストを直す: `circuit` の番地の例 (`yaml.test.ts`・`cache.test.ts`・`session.test.ts` ほか)、
   `bread` の言語名、`boardRender.test.ts` の要素の一覧
4. `docs/メモ記法.md` の `circuit` の例を新しい番地へ
5. `npm run typecheck` / `npm test` / `npm run lint` / e2e (`board-fence`・`fence-gui`)
6. 配布 (`./doDeploy.sh`)
7. 本番の 3 メモを `migrateCircuitFences` で書き換える。手元で作った `before` / `after` は
   `41-QR-search/_del/fence-0.38-migrate/migrated.json` にある (メモの本文を含むので
   コミットしない。本番の本文が変わっていたら取り直す)
8. `./doBackfill.sh circuits` — 描き直しは 3 図だけ
9. 3 メモを開いて、図が出ることと、編集 (図を編集) が通ることを確かめる

**ロールバック**: 7 で保存した `before` を戻し、`vendor/` を旧い tgz に戻して配布する。

## 6. 今回やらないこと

- **新しい 6 つのフェンス** (copper・vna・scope・spectrum・graph・logic)。QR Note に口が無い。
  vna・scope・spectrum は測った CSV を `data:` で読むので、**添付ファイルから引く口**を
  先に決める必要がある。別の計画にする
- **教科書 (tommie-circuit-workbook) の取り込み**。ノートへ入れる単位 (1 題 1 メモか) や、
  図を QR Note のフェンスで描き直すか、画像で持つかを決める必要がある。別の計画にする
- 上流のマップの名札の直し (circuit-fence 0.38.1) は、この版上げに含まれる

## 7. 未決

- 5 の 7 を人が行うか、スクリプトにするか。3 件なので手でもよいが、`before` / `after` の
  取り違えを避けるため、書き換え用の使い捨てスクリプトを勧める
- demo (qr-demo) のシードに旧い番地が無いことは確かめた (リポジトリ内のファイルのみ)。
  demo の DB 本体は未確認

## 8. 実装の結果 (2026-10-13)

- ブランチ `chore/fence-0.38` に 1 コミット (4 つの tgz・テスト・e2e・記法ヘルプ)。
  **main へは merge していない** — main から配布すると、新しい番地を読むアプリが本番に出るので、
  手順 6〜8 と同じ日にそろえる
- `npm run typecheck`・`npm run lint`・`npx vitest run` (4600 件) は通った。
  **e2e (Playwright) は回していない** — `fence-gui.spec.ts` の circuit の番地だけ直した
- 記法ヘルプの perf の例 (`board: 28x18`、穴数で書いた基板) は、上流 0.32.0 の `silk:` の
  変更で従来どおり読まれるので直していない

## 9. 配布の結果 (2026-10-13)

- 配布: `./doDeploy.sh patch` → **v0.23.19**。lint・typecheck・test・ビルドは通り、
  ヘルスチェックも通った (97 秒)
- 本番の書き換え: `scripts/backfillCircuitAddresses.ts` を足し、`./doBackfill.sh circuit-addresses`
  で実行した。先に `DRY_RUN=1` で 3 件 (1094・1095・1168) を確かめてから書いた。
  書き直しは 11・29・10 か所、要確認は 0 件。2 回目の DRY_RUN は 0 件 (冪等)
- 描き直し: `./doBackfill.sh circuits` で 3 図を描いた (失敗 0)
- 注意: `updated_at` は進めた (普通の編集と同じ。開いたままの編集画面に競合として見せるため)
- **1168 の perfboard フェンスが 0.41.0 でエラーになる**: `J1: usb-c c13 f13` は
  「usb-c は穴を 4 つ、GND D+ D- VBUS の順に書きます」と断られる (circuit の番地とは別件)。
  テスト用のノートなので本文は触っていない
- 実装に入れたもの: 手順 7 を `doBackfill.sh` のタスクにした。e2e (Playwright) は回していない
