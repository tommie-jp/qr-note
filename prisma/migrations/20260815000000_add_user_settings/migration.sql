-- 利用者ごとの小さな設定の置き場 (docs/88-選択行の色計画.md)。
-- 最初の利用者は検索結果で選択中の行の地色 (key = 'row-tint')。
--
-- 1 設定 = 1 行。JSON を 1 列に持つと 2 台から別の設定を変えたときに後勝ちで
-- 消し合うので、主キーを (user_name, key) にして衝突をその設定だけに閉じる。
-- 代理キー (id) は持たない — この 2 列以外に行を指す手段が要らない。
--
-- 索引は主キーだけで足りる。読み出しは常に「その人のこの設定」1 行を引く
-- 形 (findUnique) で、一覧する場面が無い。
CREATE TABLE "user_settings" (
    "user_name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_name","key")
);

-- 全文検索の PGroonga インデックス (20260714193604 で作成) は Prisma スキーマで
-- 表現できず drift 扱いになる。prisma migrate はここでも DROP INDEX を自動生成した
-- ため採用せず、「無ければ張り直す」ことで冪等に保つ (20260810000000 と同じ)。
CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS "items_memo_url_pgroonga_idx"
  ON "items" USING pgroonga ("memo", "url");
