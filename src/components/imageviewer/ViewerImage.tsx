"use client";

import { useState } from "react";
import { attachmentUrl, thumbUrl } from "@/lib/images/memoImages";

// ビューアの 1 枚 (docs/116 §3)。器いっぱいに object-contain で収める —
// 縦長でも横長でも**画像の全体**が器の中に見え、小さい画像は器まで拡大する。
//
// 原寸は重いので、届くまでは一覧が読み込み済みのサムネ (?thumb=1) を同じ位置に
// 敷いておく。空白の時間が無くなり、前後へ送ったときも絵が途切れない。
// 原寸が落ちたらサムネのまま残し (壊れた画像アイコンにはしない)、読めなかった
// ことを下端に出す。
// 親は relative で大きさを持つこと (中の 2 枚は absolute inset-0)。
//
// onSettled … 原寸を読み終えた・読めなかった、のどちらかで呼ぶ。スライドショーは
// ここから間隔を数える (サムネの引き伸ばしのまま次へ行かない。docs/117 §2)
export function ViewerImage({
  name,
  onSettled,
}: {
  name: string;
  onSettled?: (name: string) => void;
}) {
  // 原寸を読み終えた画像の名前。名前で持つので、送って name が変わった瞬間に
  // 「未読み込み」へ戻り、サムネが敷き直される (effect で戻す必要が無い)
  const [loadedName, setLoadedName] = useState<string | null>(null);
  // 原寸を読めなかった画像の名前 (消えた添付・セッション切れ・通信)。
  // サムネを引き伸ばしたまま黙らず、読めなかったと出す
  const [failedName, setFailedName] = useState<string | null>(null);
  const loaded = loadedName === name;
  const failed = failedName === name;
  return (
    <>
      {!loaded && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl(name)}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
      {/* next/image は使えない (画像 API はログイン必須で optimizer に Cookie が
          付かない。RowThumb と同じ) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={name}
        src={attachmentUrl(name)}
        alt="ノートの画像"
        onLoad={() => {
          setLoadedName(name);
          onSettled?.(name);
        }}
        onError={() => {
          setFailedName(name);
          onSettled?.(name);
        }}
        className="absolute inset-0 h-full w-full object-contain"
      />
      {failed && (
        <p
          role="alert"
          className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded bg-black/70 px-2 py-1 text-sm text-red-300"
        >
          原寸の画像を読み込めませんでした
        </p>
      )}
    </>
  );
}
