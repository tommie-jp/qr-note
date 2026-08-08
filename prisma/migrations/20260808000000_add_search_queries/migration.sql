-- 検索履歴と登録パターンをサーバへ移す (docs/59-検索候補計画.md §7)。
--
-- これまで localStorage に置いていた 2 つのリストを DB に持たせ、同じ人の
-- どの端末からでも同じ候補が出るようにする。1 クエリ = 1 行にしてあるのは、
-- JSON を 1 列で持つと 2 台から同時に登録したときに後勝ちで消し合うため。
--
-- 既存の items / images には触らないので、失敗しても本文と画像は無事。

CREATE TABLE "search_queries" (
    "id" SERIAL NOT NULL,
    -- 誰の履歴か。sessions.user_name / webauthn_credentials.user_name と同じ値
    "user_name" TEXT NOT NULL,
    -- 'recent' (最近の検索) か 'saved' (登録パターン)
    "kind" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    -- 最近使った順に並べるための時刻
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_queries_pkey" PRIMARY KEY ("id")
);

-- 同じ人の同じ種類に同じクエリは 1 行だけ (upsert の当て先)
CREATE UNIQUE INDEX "search_queries_user_name_kind_query_key"
  ON "search_queries" ("user_name", "kind", "query");

-- 一覧は必ず「その人の分を最近使った順で」引く
CREATE INDEX "search_queries_user_name_used_at_idx"
  ON "search_queries" ("user_name", "used_at");

-- 全文検索の PGroonga インデックス (20260714193604 で作成) は Prisma スキーマで
-- 表現できず drift 扱いになる。prisma migrate は DROP INDEX を自動生成するため
-- 採用せず、「無ければ張り直す」ことで冪等に保つ (20260805000000 と同じ)。
CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS "items_memo_url_pgroonga_idx"
  ON "items" USING pgroonga ("memo", "url");
