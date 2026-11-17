"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  useAsyncAction,
  type AsyncActionErrorHandler,
} from "@/components/hooks/useAsyncAction";
import {
  SecretLockedError,
  loadSecret,
  secretText,
  type SecretContent,
} from "@/lib/secret/content";
import { resolveNestedMedia, trackBlob } from "@/lib/secret/nestedMedia";
import { secretMimeKind, type SecretKind } from "@/lib/secret/payload";
import { SecretCancelledError } from "@/lib/secret/prf";
import {
  isUnlocked,
  subscribeSecretLock,
  useSecretUnlocked,
} from "@/lib/secret/session";
import { unlockWithPasskey } from "@/lib/secret/unlock";

// SecretBlock の「開く・隠す・コピー」をフックに分けたもの (docs/128 §8-1)。
//
// **復号した中身はここの useState と Blob URL に居る**。フックは SecretBlock の
// 中でだけ呼ぶので、寿命は以前と同じ (隠す・施錠・アンマウントで消える)

export interface SecretMedia {
  url: string;
  kind: SecretKind;
}

export type BlobKinds = ReadonlyMap<string, "image" | "audio" | "video">;

// 復号したバイト列を Blob URL にする口。差し替えの手順 (lib/secret/nestedMedia.ts)
// はブラウザの URL を直接持たず、ここから渡す
const createObjectUrl = (blob: Blob) => URL.createObjectURL(blob);

// コピーした中身をクリップボードから消すまでの時間 (パスワード管理ソフトの
// 相場に合わせる)。貼り付けには十分で、置きっぱなしにはしない長さ
export const CLIPBOARD_CLEAR_MS = 60_000;

// 作った Blob URL は自分で片付ける。放っておくとタブを閉じるまで
// 復号済みの画素がメモリに残り続ける
function useBlobUrls() {
  const blobUrls = useRef<string[]>([]);
  const revokeBlobs = useCallback(() => {
    for (const url of blobUrls.current) {
      URL.revokeObjectURL(url);
    }
    blobUrls.current = [];
  }, []);
  useEffect(() => revokeBlobs, [revokeBlobs]);
  return { blobUrls, revokeBlobs };
}

interface RevealSetters {
  setContent: (content: SecretContent) => void;
  setMedia: (media: SecretMedia) => void;
  setBlobKinds: (kinds: BlobKinds) => void;
  setMarkdown: (markdown: string) => void;
}

// 解錠 → 復号 → 中身を出す。content を先に入れ、媒体でなければ断片内の
// 画像参照を Blob URL に差し替えてから markdown を入れる (順は以前のまま)
async function revealSecret(
  name: string,
  unlocked: boolean,
  blobUrls: RefObject<string[]>,
  { setContent, setMedia, setBlobKinds, setMarkdown }: RevealSetters,
): Promise<void> {
  if (!unlocked) {
    await unlockWithPasskey();
  }
  const loaded = await loadSecret(name);
  setContent(loaded);

  const kind = secretMimeKind(loaded.mime);
  if (kind !== null && kind !== "text") {
    setMedia({
      url: trackBlob(blobUrls, loaded.bytes, loaded.mime, createObjectUrl),
      kind,
    });
    return;
  }

  const resolved = await resolveNestedMedia(secretText(loaded), blobUrls, {
    load: loadSecret,
    createObjectUrl,
  });
  setBlobKinds(resolved.kinds);
  setMarkdown(resolved.markdown);
}

function revealErrorHandler(name: string): AsyncActionErrorHandler {
  return (cause) => {
    if (cause instanceof SecretCancelledError) {
      return null; // 自分でやめた操作は失敗として出さない (auth/passkeyClient.ts と同じ)
    }
    console.error(`シークレットを開けませんでした (${name})`, cause);
    return cause instanceof Error && !(cause instanceof SecretLockedError)
      ? cause.message
      : "シークレットを開けませんでした";
  };
}

export function useSecretReveal(name: string) {
  const unlocked = useSecretUnlocked();
  const { run, busy, error, setError } = useAsyncAction();
  const [content, setContent] = useState<SecretContent | null>(null);
  // 復号した markdown。断片内の画像参照は Blob URL に差し替え済み
  const [markdown, setMarkdown] = useState<string | null>(null);
  // 断片そのものが媒体 (画像・音声・動画) のときの Blob URL と種別
  const [media, setMedia] = useState<SecretMedia | null>(null);
  // 断片の markdown に埋まった媒体の種別 (Blob URL → 種別)。
  // 拡張子を持たない Blob URL を MarkdownView が描き分けるために要る
  const [blobKinds, setBlobKinds] = useState<BlobKinds>(new Map());
  const { blobUrls, revokeBlobs } = useBlobUrls();

  const hide = useCallback(() => {
    revokeBlobs();
    setContent(null);
    setMarkdown(null);
    setMedia(null);
    setBlobKinds(new Map());
    setError(null);
  }, [revokeBlobs, setError]);

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

  const reveal = useCallback(
    () =>
      run(
        () =>
          revealSecret(name, unlocked, blobUrls, {
            setContent,
            setMedia,
            setBlobKinds,
            setMarkdown,
          }),
        revealErrorHandler(name),
      ),
    [name, unlocked, run, blobUrls],
  );

  return { content, markdown, media, blobKinds, busy, error, setError, hide, reveal };
}

// 中身をクリップボードへ写し、一定時間で消す
export function useSecretCopy(
  content: SecretContent | null,
  setError: (error: string | null) => void,
) {
  const [copied, setCopied] = useState(false);

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
  }, [content, setError]);

  return { copied, copy };
}
