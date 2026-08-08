-- memo の先頭行から Markdown 記法を剥がした見出しの派生キャッシュ
-- (docs/63-タイトル順計画.md §3)。一覧の「タイトル順」で ORDER BY に使う。
--
-- 既存行は '' のまま置く。ここで埋めようとすると SQL で Markdown を解析する
-- ことになり、コードフェンスや折りたたみの中の行を見出しにしてしまう。正しい値は
-- パーサ (src/lib/memoSummary.ts) を通すバックフィル
-- (scripts/backfillTitles.ts) で入れる。task_todo / task_done と同じ段取り。
--
-- 索引は張らない。数百件では seq scan + sort で足り、書き込みのたびに索引を
-- 更新する方が高くつく (20260805120000 と同じ判断)。

ALTER TABLE "items"
  ADD COLUMN "title" TEXT NOT NULL DEFAULT '';

-- 全文検索の PGroonga インデックス (20260714193604 で作成) は Prisma スキーマで
-- 表現できず drift 扱いになる。prisma migrate は DROP INDEX を自動生成するため
-- 採用せず、「無ければ張り直す」ことで冪等に保つ (20260805120000 と同じ)。
-- 落ちても全文検索は seq scan で動いてしまい気づけないので、手で `\di` を
-- 確かめる運用に頼らず、毎回ここで張り直す。
CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS "items_memo_url_pgroonga_idx"
  ON "items" USING pgroonga ("memo", "url");
