"use client";

import { useEffect, useState } from "react";
import { SECRET_IDLE_LOCK_MS, useSecretIdleStartedAt } from "@/lib/secret/session";

// 釦の枠をなぞる道 (viewBox 36×36。上辺の中央から時計回りに 1 周)。
// 角の丸みは釦の rounded (4px) に合わせ、線の太さの半分だけ内側を通す
const FUSE_PATH =
  "M18 1.5H30.5A4 4 0 0 1 34.5 5.5V30.5A4 4 0 0 1 30.5 34.5H5.5A4 4 0 0 1 1.5 30.5V5.5A4 4 0 0 1 5.5 1.5Z";

// 道の長さを 100 に均す (pathLength)。燃えた割合をそのまま % で書ける
const FUSE_LENGTH = 100;

// 燃えた割合 (0〜1)。数え直しの時刻と「いま」から決める純関数
export function fuseBurntRatio(startedAt: number, now: number): number {
  const ratio = (now - startedAt) / SECRET_IDLE_LOCK_MS;
  return Math.min(1, Math.max(0, ratio));
}

// シークレット内検索の残り時間を、釦の枠を燃え進む導火線で見せる
// (docs/130 §3-1)。
//
// 見せているのは**自動施錠までの残り** (無操作 5 分。secret/session.ts)。
// 検索語を打つ・断片を開くなど鍵を使うたびに数え直されるので、そのたびに
// 導火線も根元から燃え直す。燃え尽きた所で施錠され、トグルが切れる。
//
// **動きは SVG の SMIL で書く** (animate / animateMotion)。CSS の animation に
// すると、残り時間を style 属性で渡すことになり、CSP (style-src) の線引きに
// 触る。SMIL は属性だけで済み、viewBox に乗るので文字サイズの設定で釦が
// 大きくなっても枠からずれない。
//
// タブを隠している間は時計だけが進むので、戻ってきたときに「いま」を取り直して
// 途中から燃やし直す (隠して 1 分の施錠は別の時計で、ここには出さない)。
export function SecretSearchFuse() {
  const startedAt = useSecretIdleStartedAt();
  const resyncedAt = useTabResyncedAt();
  if (startedAt === null) {
    return null;
  }
  return (
    <FuseSvg
      // 数え直し・戻ってきたときに作り直す = アニメを頭から掛け直す
      key={`${startedAt}:${resyncedAt}`}
      // 数え直しより前に戻ってきた時刻は使わない (燃えた割合は 0 から)
      burnt={fuseBurntRatio(startedAt, Math.max(startedAt, resyncedAt))}
    />
  );
}

// タブへ戻ってきた時刻 (まだ無ければ 0)
function useTabResyncedAt(): number {
  const [resyncedAt, setResyncedAt] = useState(0);
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "visible") {
        setResyncedAt(Date.now());
      }
    };
    document.addEventListener("visibilitychange", resync);
    return () => document.removeEventListener("visibilitychange", resync);
  }, []);
  return resyncedAt;
}

// 放射状の線 (☀ の光条) の向き。縦横の 4 本と斜めの 4 本を別の組にして、
// 伸び縮みの拍子をずらす — 全部が同時に伸びると、ただの脈動に見える
const RAY_INNER = 2.6;
const RAY_OUTER = 5.4;
const STRAIGHT_RAY_ANGLES = [0, 90, 180, 270];
const DIAGONAL_RAY_ANGLES = [45, 135, 225, 315];

// 光条 1 組。中心からの拡大で長さを変える (線の太さは変えない)
function FuseRays({ angles, scales, dur }: { angles: number[]; scales: string; dur: string }) {
  return (
    <g className="stroke-red-600" strokeWidth={1.3} strokeLinecap="round">
      <animateTransform
        attributeName="transform"
        type="scale"
        values={scales}
        dur={dur}
        repeatCount="indefinite"
      />
      {angles.map((angle) => (
        <line
          key={angle}
          x1={RAY_INNER}
          y1={0}
          x2={RAY_OUTER}
          y2={0}
          transform={`rotate(${angle})`}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

// 導火線の先の火。赤い丸の大小と、放射状の線の長短でちらつく
function FuseFlame() {
  return (
    <>
      <FuseRays angles={STRAIGHT_RAY_ANGLES} scales="0.7;1.25;0.85;1.1;0.7" dur="0.45s" />
      <FuseRays angles={DIAGONAL_RAY_ANGLES} scales="1.05;0.6;1.2;0.75;1.05" dur="0.6s" />
      <circle r={3} className="fill-red-600">
        <animate attributeName="r" values="2.4;3.4;2.7;3.6;2.4" dur="0.5s" repeatCount="indefinite" />
      </circle>
      <circle r={1.4} className="fill-orange-300">
        <animate attributeName="r" values="1.1;1.7;1.2;1.8;1.1" dur="0.35s" repeatCount="indefinite" />
      </circle>
    </>
  );
}

// 燃えた割合から先を、残り時間をかけて燃やす
function FuseSvg({ burnt }: { burnt: number }) {
  const remainingMs = Math.max(1, Math.round((1 - burnt) * SECRET_IDLE_LOCK_MS));
  const dur = `${remainingMs}ms`;
  const burntLength = burnt * FUSE_LENGTH;

  return (
    <svg
      aria-hidden
      viewBox="0 0 36 36"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      fill="none"
    >
      {/* 残っている導火線。先頭 (燃えた分) を隠す量を増やしていく */}
      <path
        d={FUSE_PATH}
        pathLength={FUSE_LENGTH}
        className="stroke-amber-600"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={`${FUSE_LENGTH} ${FUSE_LENGTH}`}
        strokeDashoffset={-burntLength}
      >
        <animate
          attributeName="stroke-dashoffset"
          from={-burntLength}
          to={-FUSE_LENGTH}
          dur={dur}
          fill="freeze"
        />
      </path>
      {/* 火。導火線の燃えている端に乗って進み、ちらつく (FuseFlame) */}
      <g>
        <animateMotion
          path={FUSE_PATH}
          dur={dur}
          fill="freeze"
          calcMode="linear"
          keyPoints={`${burnt};1`}
          keyTimes="0;1"
        />
        <FuseFlame />
      </g>
    </svg>
  );
}
