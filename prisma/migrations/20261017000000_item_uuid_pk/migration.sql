-- ノートの主キーを itemNo (旧番号) から UUID v7 へ移す (docs/107-ノート主キー計画.md)。
--
-- 1 本の migration で最後まで済ませる。デモの種 DB (qr_seed) にも doDeploy.sh が
-- 同じ migration を当てるので、データの書き換えも SQL の中に置く必要がある
-- (TS のスクリプトにすると種だけ旧番号のまま残り、毎時のリセットで戻ってしまう)。
--
-- 手順:
--   1. id 列を足し、旧番号の昇順に時刻をずらして振る (id 順 = 旧番号順)
--   2. 旧番号 → id の控えを legacy_item_nos に残す (git 履歴の改名用)
--   3. 本文の相対リンク `](/item/<旧番号>` を `](/item/<id>` に書き換える
--   4. 旧番号を本文の末尾にタグ `#<旧番号>` として足し、tags 列にも足す
--   5. 主キーを付け替え、item_no / item_no_num を落とす
--
-- updated_at は動かさない。本文は書き換えるが、利用者の編集ではないので
-- 「更新順」で全ノートが同着の先頭に来るのは嘘になる (accessed_at と同じ考え方)。

-- 1. id。uuidv7(interval) は時刻をずらして作る (PostgreSQL 18)。
--    1 行ごとに 1 ms ずつずらし、**全部を過去側に置く** — 未来側にずらすと、
--    移行の直後に作ったノートの id が移行分より小さくなりうる。
--    非数字の旧番号 (100x・教科書の wb01-03-08 など) は数字の後ろに、文字列順で並ぶ
--    (いままでの番号順と同じ並び)
ALTER TABLE "items" ADD COLUMN "id" uuid;

WITH "ordered" AS (
  SELECT "item_no",
         row_number() OVER (ORDER BY "item_no_num" ASC NULLS LAST, "item_no" ASC) AS "rn",
         count(*) OVER () AS "total"
  FROM "items"
)
UPDATE "items"
SET "id" = uuidv7(make_interval(secs => ("ordered"."rn" - "ordered"."total" - 1) / 1000.0))
FROM "ordered"
WHERE "items"."item_no" = "ordered"."item_no";

ALTER TABLE "items" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "items" ALTER COLUMN "id" SET DEFAULT uuidv7();

-- 2. 控え
CREATE TABLE "legacy_item_nos" (
  "item_no" TEXT NOT NULL,
  "item_id" UUID NOT NULL,
  CONSTRAINT "legacy_item_nos_pkey" PRIMARY KEY ("item_no")
);

INSERT INTO "legacy_item_nos" ("item_no", "item_id")
SELECT "item_no", "id" FROM "items";

-- 3. 本文のリンク。対象は Markdown の相対リンク `](/item/<旧番号>` だけ。
--    絶対 URL (http://qr.tommie.jp/item/3030) は本文に書いたシールの文字列でも
--    あるので触らず、旧 URL の解決に任せる。他サイトの /item/ (aliexpress など) は
--    `](` の直後に来ないので巻き込まない。
--    後ろの (?=…) で番号の切れ目を見る (wb05-01-01 が wb05-01-01b に当たらないように)。
--    PGroonga は LIKE を乗っ取るので、絞り込みは position() で書く
DO $$
DECLARE
  "r" record;
BEGIN
  FOR "r" IN SELECT "item_no", "id" FROM "items" LOOP
    UPDATE "items"
    SET "memo" = regexp_replace(
      "memo",
      '\]\(/item/' || "r"."item_no" || '(?=[)#?\s]|$)',
      '](/item/' || "r"."id"::text,
      'g'
    )
    WHERE position('](/item/' || "r"."item_no" IN "memo") > 0;
  END LOOP;
END $$;

-- 4. 旧番号をタグに。置き場所は**本文の末尾の行**にする。
--    タグの抽出 (lib/markdown/tags/tags.ts の extractTags) は閉じたコードフェンスと
--    インラインコードだけを除くので、末尾に足した行は必ずタグとして拾われる
--    (2 行目に差し込むと、1 行目がフェンスの開きのときにフェンスの中に落ちる)。
--    旧番号は [0-9A-Za-z_-] だけなので、タグの正規化 (NFKC + 小文字) は lower() と同じ。
--    改行は本文に合わせる (編集画面を通った本文は CRLF)
UPDATE "items"
SET "memo" = CASE
      WHEN "memo" = '' THEN '#' || "item_no"
      WHEN "memo" ~ '\n$' THEN "memo" || '#' || "item_no"
      WHEN position(E'\r\n' IN "memo") > 0 THEN "memo" || E'\r\n#' || "item_no"
      ELSE "memo" || E'\n#' || "item_no"
    END,
    "tags" = "tags" || lower("item_no"),
    -- 見出しが空だった本文 (空・画像だけ) は、足したタグ行が見出しになる
    -- (memoSummary はタグ行も見出しとして読む)。派生列を本文に揃える
    "title" = CASE WHEN "title" = '' THEN '#' || "item_no" ELSE "title" END
WHERE NOT ("tags" @> ARRAY[lower("item_no")]);

-- 5. 主キーの付け替え
ALTER TABLE "items" DROP CONSTRAINT "items_pkey";
DROP INDEX IF EXISTS "items_item_no_num_idx";
ALTER TABLE "items" DROP COLUMN "item_no", DROP COLUMN "item_no_num";
ALTER TABLE "items" ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");

-- PGroonga 索引は memo の UPDATE に追従する。prisma migrate が落とすことがある
-- ので念のため張り直しておく (冪等)
CREATE EXTENSION IF NOT EXISTS pgroonga;
CREATE INDEX IF NOT EXISTS "items_memo_url_pgroonga_idx"
  ON "items" USING pgroonga ("memo", "url");
