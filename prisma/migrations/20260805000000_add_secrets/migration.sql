-- 部分暗号化 (docs/51-部分暗号化計画.md)。ノートの機微部分だけをクライアントで
-- 暗号化して置くための表を足す。
--
-- secrets        … 暗号エンベロープ。サーバは鍵を持たないので復号できない。
-- secret_keyring … 鍵束の検証値 (1 行だけ)。マスターキー本体は保存しない。
-- webauthn_credentials.secret_key_wrap … パスキーごとの包んだマスターキー。
--
-- 既存の items / images には触らないので、失敗しても本文と画像は無事。

CREATE TABLE "secrets" (
    "name" TEXT NOT NULL,
    -- 復号後の中身の種別 (text/markdown・image/* など)。暗号化しないメタデータ
    "mime" TEXT NOT NULL,
    -- version || iv || AES-256-GCM の暗号文 (src/lib/secretEnvelope.ts)
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secrets_pkey" PRIMARY KEY ("name")
);

CREATE TABLE "secret_keyring" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "verifier" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secret_keyring_pkey" PRIMARY KEY ("id")
);

-- 鍵束は 1 つだけ。利用者は 1 名 (docs/29 §11) なので、2 行目ができる状況は
-- 必ず不具合。アプリ側の upsert に頼らず DB でも縛る
ALTER TABLE "secret_keyring"
  ADD CONSTRAINT "secret_keyring_single_row" CHECK ("id" = 1);

ALTER TABLE "webauthn_credentials"
  ADD COLUMN "secret_key_wrap" BYTEA;

-- 全文検索の PGroonga インデックス (20260714193604 で作成) は Prisma スキーマで
-- 表現できず drift 扱いになる。prisma migrate は DROP INDEX を自動生成するため
-- 採用せず、「無ければ張り直す」ことで冪等に保つ (20260719000000 と同じ)。
CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS "items_memo_url_pgroonga_idx"
  ON "items" USING pgroonga ("memo", "url");
