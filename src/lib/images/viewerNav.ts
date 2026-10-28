// 検索結果の画像ビューア (docs/116-検索結果の画像最大表示計画.md) が出す 1 枚。
// 画像はノート単位ではなく「どのノートのどの画像か」で決まる (同じ画像を
// 別ノートが参照できるので名前だけでは一意にならない — ImageMasonry の key と同じ)
export interface ViewerTarget {
  itemId: string;
  name: string;
  // 「ノートを開く」の行き先。一覧が組んだ検索状態つきの URL をそのまま使う
  href: string;
}

export function sameTarget(a: ViewerTarget, b: ViewerTarget): boolean {
  return a.itemId === b.itemId && a.name === b.name;
}

function targetKey(t: ViewerTarget): string {
  return `${t.itemId}:${t.name}`;
}

// 一覧に並んでいる順の画像から、current の隣 (dir = -1 前 / +1 次) を返す。
// 端では null (回り込まない)。current が一覧から消えた (3 ペインで検索語を
// 打ち替えた) ときは、送る向きの端 (次なら先頭・前なら末尾) から出直す —
// 押しても何も起きない、にしない。同じ画像が 2 度並んでも 1 枚目だけを数える
export function neighborTarget(
  targets: readonly ViewerTarget[],
  current: ViewerTarget,
  dir: -1 | 1,
): ViewerTarget | null {
  const seen = new Set<string>();
  const unique = targets.filter((t) => {
    const key = targetKey(t);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const currentKey = targetKey(current);
  const index = unique.findIndex((t) => targetKey(t) === currentKey);
  if (index === -1) {
    return (dir === 1 ? unique[0] : unique.at(-1)) ?? null;
  }
  return unique[index + dir] ?? null;
}

// 1 枚送ったらどうなるか。手の ← → とスライドショーの自動送りが共有する。
//
//   move … 隣の画像へ送る
//   wait … 一覧の末尾。続きのページがあるので、読み込みを頼んで待つ
//   end  … 続きも尽きた端 (または前へ送って先頭)。手の送りはここで止まり、
//          スライドショーは一覧の先頭へ戻る
//
// hasMore は「一覧に続きのページがあるか」(loadMore.ts の目印が居るか)。
// 前へ送るときは続きを見ない — 前のページは既に全部読み込まれている
export type StepPlan =
  | { kind: "move"; target: ViewerTarget }
  | { kind: "wait" }
  | { kind: "end" };

export function planStep(
  targets: readonly ViewerTarget[],
  current: ViewerTarget,
  dir: -1 | 1,
  hasMore: boolean,
): StepPlan {
  const next = neighborTarget(targets, current, dir);
  if (next !== null) {
    return { kind: "move", target: next };
  }
  return dir === 1 && hasMore ? { kind: "wait" } : { kind: "end" };
}

// スライドショーで、いま出ている 1 枚を何 ms 見せてから送るか (docs/117 §2・§8-3)。
// null は「まだ数えない」(再生中の動画は最後まで待つ)。
//
//   画像 … 原寸を読み終えたら間隔。読み終わらなければ settleWaitMs で見切る
//   動画 … 再生し終えたら endPauseMs (最後のコマを見る間)。再生できなかったら
//          画像と同じく間隔。再生中・始まる前は待つ (始まらないときは
//          ViewerVideo が見切って settled にする)
//
// 順番が要点: 動画は「終わった」を「再生できなかった」より先に見る
export interface SlideDelayInput {
  isVideo: boolean;
  settled: boolean;
  ended: boolean;
  intervalMs: number;
  settleWaitMs: number;
  endPauseMs: number;
}

export function slideDelay({
  isVideo,
  settled,
  ended,
  intervalMs,
  settleWaitMs,
  endPauseMs,
}: SlideDelayInput): number | null {
  if (isVideo) {
    if (ended) {
      return endPauseMs;
    }
    return settled ? intervalMs : null;
  }
  return settled ? intervalMs : settleWaitMs;
}
