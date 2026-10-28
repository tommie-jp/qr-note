"use client";

// 一覧の動画のサムネを「動くサムネ」(アニメーション WebP) にする
// (docs/72-動画アニメサムネ計画.md・docs/117 §8-8)。
//
// **一覧に <video> を並べない**のが前提。行数ぶんの動画を同時に読みに行くと
// モバイル回線で破綻する (13-kick-work のショートで実測済み)。<img> の src を
// アニメ WebP にするだけなら、1 本あたり最大 300KB で済む。
//
// **常に動かす** (2026-10-28 ユーザー指示)。以前は PC はホバー中だけ、スマホは
// 画面にしっかり入ったものだけを 1 セッション 30 本まで動かしていた
// (animThumbBudget.ts。転送量を抑えるため)。いまは最初から動くサムネを配る。
// 画面外の <img> は loading="lazy" で読み込みが後回しになる。
//
// 動くサムネが未生成 (404) の動画は静止サムネへ戻し、以後は試さない
// (押すたびに 404 を叩きに行かない)。
//
// **サーバ描画では静止サムネ、ブラウザで動き出してから動くサムネに替える。**
// サーバが最初から動くサムネの URL を描くと、未生成の動画 (既存の動画には
// 多い。docs/72) は React が動き出す前に 404 になり、onError を拾えずに
// 壊れた画像のまま残る。替えるのは動き出した後なので、404 は必ず拾える

import { useCallback, useState, useSyncExternalStore } from "react";

const subscribeNothing = () => () => {};

export interface AnimThumb {
  // 今アニメを出しているか。false のときは静止サムネ
  playing: boolean;
  // アニメが取れなかった (未生成 = 404) ときに呼ぶ。以後このサムネでは試さない
  fail: () => void;
}

// enabled が false のときは静止のまま (画像のサムネ・poster が無い動画)
export function useAnimThumb(enabled: boolean): AnimThumb {
  const [failed, setFailed] = useState(false);
  // サーバ描画とハイドレーションの間は false、動き出したら true
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const fail = useCallback(() => setFailed(true), []);
  return { playing: enabled && hydrated && !failed, fail };
}
