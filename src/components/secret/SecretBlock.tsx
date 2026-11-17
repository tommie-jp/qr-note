"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import {
  SecretMediaView,
  SecretPlaceholder,
  SecretRevealedHeader,
} from "./SecretBlockParts";
import { SecretMarkdown } from "./SecretMarkdown";
import { useSecretCopy, useSecretReveal } from "./useSecretReveal";

// 開いた中身は MarkdownView で描くが、ここからは import しない。MarkdownView 側が
// img からこの部品へ振り分けるため循環になる。layout の SecretMarkdownProvider が
// 動的に読んだ MarkdownView を context で渡す (SecretMarkdown.tsx の注)

// 入力ダイアログも開くまで読まない (編集画面と同じ流儀)。閲覧画面から
// 編集できるようにするため、こちらからも同じ部品を使う (docs/52 §2)
const SecretDialog = dynamic(
  () => import("./SecretDialog").then((m) => m.SecretDialog),
  { ssr: false, loading: () => null },
);

interface SecretBlockProps {
  name: string;
  // 本文に平文で残っているラベル。**中身ではない** (docs/51 §1 の割り切り)
  label: string;
  // 展開表示に「編集」を出すか (docs/52-シークレット編集導線計画.md §2)。
  // ノート閲覧 (ItemView) からのみ true。公開ビュー・印刷・docs ページには
  // 出さない (allowRotate と同じ作法。docs/49 §2)
  allowEdit?: boolean;
}

// 本文に貼られたシークレット断片 (docs/51-部分暗号化計画.md §9)。
//
// 既定は「🔒 ラベル」のプレースホルダで、**中身は押すまで取りに行かない**。
// 肩越しの覗き見対策であり、鍵が無いときに何度も認証器を呼ばないためでもある。
//
// 画像・音声・PDF と同じく MarkdownView の img から振り分けられて描かれる
// (記法は `![ラベル](/api/secrets/<name>)`)。
export function SecretBlock({
  name,
  label,
  allowEdit = false,
}: SecretBlockProps) {
  const { content, markdown, media, blobKinds, busy, error, setError, hide, reveal } =
    useSecretReveal(name);
  const { copied, copy } = useSecretCopy(content, setError);
  const [editing, setEditing] = useState(false);

  if (content === null) {
    return (
      <SecretPlaceholder label={label} busy={busy} error={error} onReveal={reveal} />
    );
  }

  return (
    <span className="not-prose block rounded border border-amber-300 bg-amber-50/60 p-2">
      <SecretRevealedHeader
        label={label}
        isText={markdown !== null}
        allowEdit={allowEdit}
        copied={copied}
        onHide={hide}
        onCopy={copy}
        onEdit={() => setEditing(true)}
      />

      <SecretMediaView media={media} label={label} />

      {markdown !== null && (
        // 通常のメモと同じ描画パイプライン (同じサニタイズ) を通す。
        // タグはリンクにしない — 断片の中身から検索へ飛ばす導線は、平文の
        // 検索語をサーバへ送ることになるため (docs/51 §5)
        <SecretMarkdown markdown={markdown} linkTags={false} blobKinds={blobKinds} />
      )}

      {error !== null && <span className="text-sm text-red-700">{error}</span>}

      {/* 閲覧画面からの編集 (docs/52 §2)。中身の保存は同名上書きで本文に
          触れないので、memo を持たないこの画面からでも成立する。
          保存後は取り直す — サーバ側が変わった以上、手元の復号済みを
          信じるより開き直すほうが確実 (Blob URL の張り替えも同じ経路に乗る) */}
      {editing && (
        <SecretDialog
          name={name}
          initialText=""
          initialLabel={label}
          hideLabel
          onSaved={() => {
            setEditing(false);
            void reveal();
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </span>
  );
}
