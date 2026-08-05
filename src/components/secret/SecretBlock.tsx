"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { BUSY_SPINNER_CLASS } from "@/components/ui";
import {
  SecretLockedError,
  loadSecret,
  secretText,
  type SecretContent,
} from "@/lib/secretContent";
import { secretMimeKind, type SecretKind } from "@/lib/secretPayload";
import { SecretCancelledError } from "@/lib/secretPrf";
import {
  isUnlocked,
  subscribeSecretLock,
  useSecretUnlocked,
} from "@/lib/secretSession";
import { unlockWithPasskey } from "@/lib/secretUnlock";
import { allSecretNames, secretUrl } from "@/lib/secrets";

// MarkdownView は**動的に読む**。理由は 2 つ:
//
// - MarkdownView 側が img からこの部品へ振り分けるため、静的 import にすると
//   循環参照になる (どちらかが評価途中の undefined を掴みうる)。
// - react-markdown + KaTeX 一式は重い。断片を開くまで読み込まなければ、
//   シークレットを使わないノートの表示は今までどおり軽いまま
//   (DrawModal / ScannerModal と同じ流儀)。
const MarkdownView = dynamic(
  () => import("@/components/MarkdownView").then((m) => m.MarkdownView),
  { ssr: false, loading: () => null },
);

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

// 断片の中に貼れる媒体の数。復号 → Blob URL を一度に抱える上限で、
// 際限なく並べられると解錠のたびにその数ぶんメモリを掴むため
// (動画は 1 本で数十 MB になりうる)
const MAX_NESTED_MEDIA = 20;

// コピーした中身をクリップボードから消すまでの時間 (パスワード管理ソフトの
// 相場に合わせる)。貼り付けには十分で、置きっぱなしにはしない長さ
const CLIPBOARD_CLEAR_MS = 60_000;

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
  const unlocked = useSecretUnlocked();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<SecretContent | null>(null);
  // 復号した markdown。断片内の画像参照は Blob URL に差し替え済み
  const [markdown, setMarkdown] = useState<string | null>(null);
  // 断片そのものが媒体 (画像・音声・動画) のときの Blob URL と種別
  const [media, setMedia] = useState<{ url: string; kind: SecretKind } | null>(
    null,
  );
  // 断片の markdown に埋まった媒体の種別 (Blob URL → 種別)。
  // 拡張子を持たない Blob URL を MarkdownView が描き分けるために要る
  const [blobKinds, setBlobKinds] = useState<
    ReadonlyMap<string, "image" | "audio" | "video">
  >(new Map());
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  // 作った Blob URL は自分で片付ける。放っておくとタブを閉じるまで
  // 復号済みの画素がメモリに残り続ける
  const blobUrls = useRef<string[]>([]);
  const revokeBlobs = useCallback(() => {
    for (const url of blobUrls.current) {
      URL.revokeObjectURL(url);
    }
    blobUrls.current = [];
  }, []);
  useEffect(() => revokeBlobs, [revokeBlobs]);

  const hide = useCallback(() => {
    revokeBlobs();
    setContent(null);
    setMarkdown(null);
    setMedia(null);
    setBlobKinds(new Map());
    setError(null);
  }, [revokeBlobs]);

  // 鍵が消えたら (施錠) 表示中の中身も引っ込め、Blob URL も解放する。
  //
  // 「unlocked が false になったら」を effect で見ずに購読で受けるのは、
  // 施錠が React の外で起きる出来事だから (別のタブ・別の画面からも起こる)。
  useEffect(
    () =>
      subscribeSecretLock(() => {
        if (!isUnlocked()) {
          hide();
        }
      }),
    [hide],
  );

  const reveal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!unlocked) {
        await unlockWithPasskey();
      }
      const loaded = await loadSecret(name);
      setContent(loaded);

      const kind = secretMimeKind(loaded.mime);
      if (kind !== null && kind !== "text") {
        setMedia({
          url: trackBlob(blobUrls, loaded.bytes, loaded.mime),
          kind,
        });
        return;
      }

      const resolved = await resolveNestedMedia(secretText(loaded), blobUrls);
      setBlobKinds(resolved.kinds);
      setMarkdown(resolved.markdown);
    } catch (cause) {
      if (cause instanceof SecretCancelledError) {
        return; // 自分でやめた操作は失敗として出さない (passkeyClient.ts と同じ)
      }
      console.error(`シークレットを開けませんでした (${name})`, cause);
      setError(
        cause instanceof Error && !(cause instanceof SecretLockedError)
          ? cause.message
          : "シークレットを開けませんでした",
      );
    } finally {
      setBusy(false);
    }
  }, [name, unlocked]);

  const copy = useCallback(async () => {
    if (content === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(secretText(content));
      setCopied(true);
      // 一定時間で消す。クリップボードは OS の履歴機能 (Windows のクラウド
      // 同期履歴・Apple の Universal Clipboard・各種拡張) を通じてアプリの外へ
      // 出ていくため、パスワードを置きっぱなしにしない (パスワード管理ソフトが
      // 揃って同じことをしている理由)。**消える旨は画面に出す** — 黙って消すと
      // 「貼れなくなった」という不具合に見える
      window.setTimeout(() => {
        setCopied(false);
        void navigator.clipboard.writeText("").catch((cause: unknown) => {
          // 画面から目を離している間はブラウザが書き込みを断ることがある。
          // 消せなかったことは記録するが、画面を驚かせるほどではない
          console.error("クリップボードを消せませんでした", cause);
        });
      }, CLIPBOARD_CLEAR_MS);
    } catch (cause) {
      console.error("クリップボードにコピーできませんでした", cause);
      setError("コピーできませんでした");
    }
  }, [content]);

  if (content === null) {
    return (
      <span className="not-prose inline-flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={reveal}
          disabled={busy}
          className="inline-flex min-h-9 items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2.5 text-left font-medium text-amber-900 transition active:scale-95 disabled:opacity-60"
        >
          {busy ? <span aria-hidden className={BUSY_SPINNER_CLASS} /> : "🔒"}
          {label}
        </button>
        {error !== null && (
          <span className="text-sm text-red-700">{error}</span>
        )}
      </span>
    );
  }

  return (
    <span className="not-prose block rounded border border-amber-300 bg-amber-50/60 p-2">
      <span className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium text-amber-900">
        🔓 {label}
        <button
          type="button"
          onClick={hide}
          className="min-h-9 rounded px-2 text-amber-800 underline"
        >
          隠す
        </button>
        {markdown !== null && (
          <button
            type="button"
            onClick={copy}
            className="min-h-9 rounded px-2 text-amber-800 underline"
          >
            {copied
              ? `コピーしました (${CLIPBOARD_CLEAR_MS / 1000} 秒で消えます)`
              : "コピー"}
          </button>
        )}
        {/* 画像の断片には出さない (文字として開けない。docs/51 §9 のガードと
            同じ理由)。ラベルの変更は本文の編集なので、ここではできない */}
        {allowEdit && markdown !== null && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-9 rounded px-2 text-amber-800 underline"
          >
            編集
          </button>
        )}
      </span>

      {media?.kind === "image" && (
        /* Blob URL なので next/image の最適化 (サーバ経由) は通せない。通したら
           復号した画素がサーバへ渡ることになり、この機能の目的そのものに反する */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt={label} className="max-w-full rounded" />
      )}

      {/* 音声・動画は復号した全体を Blob で再生する。**シークできない** —
          通常の添付のような Range 配信はサーバが復号できない以上できない
          (docs/53 §2) */}
      {media?.kind === "audio" && (
        <audio controls src={media.url} className="w-full" />
      )}
      {media?.kind === "video" && (
        <video controls playsInline src={media.url} className="max-w-full rounded" />
      )}

      {markdown !== null && (
        // 通常のメモと同じ描画パイプライン (同じサニタイズ) を通す。
        // タグはリンクにしない — 断片の中身から検索へ飛ばす導線は、平文の
        // 検索語をサーバへ送ることになるため (docs/51 §5)
        <MarkdownView markdown={markdown} linkTags={false} blobKinds={blobKinds} />
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

// 断片内の媒体参照 (`/api/secrets/<name>`) を、復号した Blob URL に差し替える。
//
// **サーバへ問い合わせるのは暗号文だけ**で、復号はこのブラウザで行う。
// 開けなかったものは参照を残したまま (割れた画像として見える) — 黙って
// 消すと「元から無かった」ように見えてしまう。
//
// Blob URL は拡張子を持たないので、音声・動画を MarkdownView が描き分ける
// ための対応表も一緒に作って返す (docs/53 §5)。
async function resolveNestedMedia(
  markdown: string,
  blobUrls: React.RefObject<string[]>,
): Promise<{
  markdown: string;
  kinds: ReadonlyMap<string, "image" | "audio" | "video">;
}> {
  const all = allSecretNames(markdown);
  const names = all.slice(0, MAX_NESTED_MEDIA);
  if (all.length > names.length) {
    // 打ち切りを黙って行わない。上限を超えた分が出ない理由が誰にも分からなくなる
    console.warn(
      `断片内の媒体は ${MAX_NESTED_MEDIA} 個までです (${all.length} 個あるうち ${
        all.length - names.length
      } 個を表示していません)`,
    );
  }

  const kinds = new Map<string, "image" | "audio" | "video">();
  let resolved = markdown;

  for (const name of names) {
    try {
      const nested = await loadSecret(name);
      const kind = secretMimeKind(nested.mime);
      if (kind === null || kind === "text") {
        continue;
      }
      const url = trackBlob(blobUrls, nested.bytes, nested.mime);
      kinds.set(url, kind);
      resolved = resolved.split(secretUrl(name)).join(url);
    } catch (cause) {
      console.error(`断片内の媒体を開けませんでした (${name})`, cause);
    }
  }

  return { markdown: resolved, kinds };
}

function trackBlob(
  blobUrls: React.RefObject<string[]>,
  bytes: Uint8Array,
  mime: string,
): string {
  const url = URL.createObjectURL(
    new Blob([bytes as unknown as BlobPart], { type: mime }),
  );
  blobUrls.current.push(url);
  return url;
}
