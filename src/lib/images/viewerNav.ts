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
