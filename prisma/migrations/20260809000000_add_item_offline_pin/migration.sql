-- 「オフラインで常に使う」印 (docs/65-オフライン対応計画.md §7)。
--
-- true のノートは、本文だけでなく添付の原寸・回路図・シークレット断片まで
-- 端末へ持ち出す。既定は false — 印を付けるのは通信量と保存容量を払う判断
-- なので、既存のノートを黙って対象にしない。
--
-- 索引は張らない。同期は全件を 1 クエリで引くので絞り込みには使わない
-- (20260805120000 / 20260808120000 と同じ判断)。

ALTER TABLE "items"
  ADD COLUMN "offline_pin" BOOLEAN NOT NULL DEFAULT false;

-- 全文検索の PGroonga インデックス (20260714193604 で作成) は Prisma スキーマで
-- 表現できず drift 扱いになる。prisma migrate は DROP INDEX を自動生成するため
-- 採用せず、「無ければ張り直す」ことで冪等に保つ (20260808120000 と同じ)。
-- 落ちても全文検索は seq scan で動いてしまい気づけないので、手で `\di` を
-- 確かめる運用に頼らず、毎回ここで張り直す。
CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS "items_memo_url_pgroonga_idx"
  ON "items" USING pgroonga ("memo", "url");
