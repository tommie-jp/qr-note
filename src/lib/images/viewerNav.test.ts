import { expect, test } from "vitest";
import {
  neighborTarget,
  planStep,
  sameTarget,
  type ViewerTarget,
} from "./viewerNav";

const t = (itemId: string, name: string): ViewerTarget => ({
  itemId,
  name,
  href: `/item/${itemId}`,
});

const list = [t("a", "1.jpg"), t("a", "2.jpg"), t("b", "3.jpg")];

test("次と前は並び順の隣を返す (ノートをまたいでも続けて送る)", () => {
  expect(neighborTarget(list, t("a", "2.jpg"), 1)).toEqual(t("b", "3.jpg"));
  expect(neighborTarget(list, t("a", "2.jpg"), -1)).toEqual(t("a", "1.jpg"));
});

test("端では null (先頭の前・末尾の次へは回り込まない)", () => {
  expect(neighborTarget(list, t("a", "1.jpg"), -1)).toBeNull();
  expect(neighborTarget(list, t("b", "3.jpg"), 1)).toBeNull();
});

test("一覧から消えた画像からは、送る向きの端から出直す", () => {
  expect(neighborTarget(list, t("z", "9.jpg"), 1)).toEqual(t("a", "1.jpg"));
  expect(neighborTarget(list, t("z", "9.jpg"), -1)).toEqual(t("b", "3.jpg"));
  expect(neighborTarget([], t("z", "9.jpg"), 1)).toBeNull();
});

test("同じ画像でもノートが違えば別の 1 枚として数える", () => {
  const shared = [t("a", "1.jpg"), t("b", "1.jpg")];
  expect(neighborTarget(shared, t("a", "1.jpg"), 1)).toEqual(t("b", "1.jpg"));
  expect(sameTarget(t("a", "1.jpg"), t("b", "1.jpg"))).toBe(false);
});

test("重複して並んだ画像は 1 枚目だけを数える", () => {
  const dup = [t("a", "1.jpg"), t("a", "1.jpg"), t("b", "2.jpg")];
  expect(neighborTarget(dup, t("a", "1.jpg"), 1)).toEqual(t("b", "2.jpg"));
  expect(neighborTarget(dup, t("b", "2.jpg"), -1)).toEqual(t("a", "1.jpg"));
});

test("隣があれば送る (続きのページの有無は見ない)", () => {
  expect(planStep(list, t("a", "1.jpg"), 1, true)).toEqual({
    kind: "move",
    target: t("a", "2.jpg"),
  });
});

test("末尾で次へ送るとき、続きのページがあれば読み込みを待つ", () => {
  expect(planStep(list, t("b", "3.jpg"), 1, true)).toEqual({ kind: "wait" });
});

test("末尾で続きも尽きていれば end (スライドショーはここで止まる)", () => {
  expect(planStep(list, t("b", "3.jpg"), 1, false)).toEqual({ kind: "end" });
});

test("先頭で前へ送ると、続きのページがあっても end", () => {
  expect(planStep(list, t("a", "1.jpg"), -1, true)).toEqual({ kind: "end" });
});
