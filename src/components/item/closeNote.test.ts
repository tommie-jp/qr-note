import { expect, test } from "vitest";
import { closeNoteTargetIndex } from "./closeNote";

const at = (path: string) => `https://note.example${path}`;

test("ペインで開いていた同じノートを飛ばして一覧へ戻る", () => {
  // Arrange: 一覧 → ペイン (横取りで URL は /item) → 全画面で開く
  const urls = [at("/?q=BJT"), at("/item/4951?q=BJT"), at("/item/4951?q=BJT")];

  // Act
  const index = closeNoteTargetIndex(urls, 2);

  // Assert
  expect(index).toBe(0);
});

test("保存直後でも編集画面へは戻らない", () => {
  const urls = [
    at("/?q=BJT"),
    at("/item/4951?q=BJT"),
    at("/edit/4951"),
    at("/item/4951?saved=1"),
  ];
  expect(closeNoteTargetIndex(urls, 3)).toBe(0);
});

test("「次 →」で渡ってきた前のノートも飛ばす", () => {
  const urls = [at("/?q=BJT"), at("/item/1?q=BJT"), at("/item/2?q=BJT")];
  expect(closeNoteTargetIndex(urls, 2)).toBe(0);
});

test("ノートでない画面 (ゴミ箱など) から来たらそこへ戻る", () => {
  const urls = [at("/?q=BJT"), at("/trash"), at("/item/4951")];
  expect(closeNoteTargetIndex(urls, 2)).toBe(1);
});

test("遡ってもノートの画面しか無ければ null (呼ぶ側が一覧へ送る)", () => {
  // QR シールから開いて「次 →」を押しただけ、など
  expect(closeNoteTargetIndex([at("/item/1"), at("/item/2")], 1)).toBeNull();
  expect(closeNoteTargetIndex([at("/item/1")], 0)).toBeNull();
});

test("新規作成の画面も飛ばす", () => {
  const urls = [at("/"), at("/new"), at("/item/4951?saved=1")];
  expect(closeNoteTargetIndex(urls, 2)).toBe(0);
});

test("url が取れない項目では飛ばしすぎずに止まる", () => {
  expect(closeNoteTargetIndex([at("/"), null, at("/item/1")], 2)).toBe(1);
});

test("今より先 (進む側) の履歴は見ない", () => {
  const urls = [at("/?q=a"), at("/item/1"), at("/trash")];
  expect(closeNoteTargetIndex(urls, 1)).toBe(0);
});
