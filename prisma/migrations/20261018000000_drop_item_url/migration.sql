-- url 列と mode 列をやめる (docs/110-URL列廃止計画.md)。
--
-- Ver1 の「URL ノート」(QR → /item → url へ redirect) は Ver2 では
-- redirect せず本文の上に URL の箱を出すだけになっていた。使っている
-- ノートは 14 件で、本文の 1 行にすれば済む。
--
-- 折り込みの形 (lib/zip/noteFile.ts の foldLegacyUrl と同じ):
--   mode = url  … URL を 1 行目にし、元の本文を空行を挟んで続ける。
--   mode = memo … 本文の末尾に空行を挟んで URL の段落を足す。1 行目の直後に
--                 挟まないのは、1 行目がフェンスの開始や表のヘッダだと構造を
--                 割ってしまうため。
-- title (見出しの派生列) は本文が URL で始まることになる行だけ URL にする。
-- 正確な値 (memoSummary) は配布後の backfillTitles.ts (doDeploy.sh が流す)
-- で揃う。updated_at は触らない (内容の意味は変わっていない)。
--
-- 空白・改行だけの url が実データにある (Ver1 由来) ので、前後の空白を
-- 落としてから見る。冪等: 途中で失敗して当て直したとき、既に折り込んだ行は
-- position() で外す
UPDATE "items"
SET
  "memo" = CASE
    WHEN "memo" = '' THEN btrim("url", E' \t\r\n')
    WHEN "mode" = 'url' THEN btrim("url", E' \t\r\n') || E'\n\n' || "memo"
    ELSE "memo" || E'\n\n' || btrim("url", E' \t\r\n')
  END,
  "title" = CASE
    WHEN "mode" = 'url' OR "memo" = '' THEN btrim("url", E' \t\r\n')
    ELSE "title"
  END
WHERE btrim("url", E' \t\r\n') <> ''
  AND position(btrim("url", E' \t\r\n') IN "memo") = 0;

-- 全文検索の索引は memo だけに張り直す (名前も変える)
DROP INDEX IF EXISTS "items_memo_url_pgroonga_idx";

ALTER TABLE "items" DROP COLUMN "url", DROP COLUMN "mode";

DROP TYPE "Mode";

CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS "items_memo_pgroonga_idx"
  ON "items" USING pgroonga ("memo");
