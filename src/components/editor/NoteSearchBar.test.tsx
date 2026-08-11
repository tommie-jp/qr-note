import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { NoteSearchBar, type NoteSearchBarProps } from "./NoteSearchBar";

// 帯の見た目 (docs/76-ノート内検索計画.md §2)。押した後の動きは
// MemoEditorInner が持つので、ここで見るのは「何が出るか / 押せるか」だけ。

const noop = () => {};

const render = (props: Partial<NoteSearchBarProps> = {}) =>
  renderToStaticMarkup(
    <NoteSearchBar
      search="抵抗"
      replace=""
      caseSensitive={false}
      showReplace={false}
      count={{ total: 12, current: 3 }}
      note={null}
      onSearchChange={noop}
      onReplaceChange={noop}
      onToggleCase={noop}
      onToggleReplace={noop}
      onFindNext={noop}
      onFindPrev={noop}
      onReplaceOne={noop}
      onReplaceAll={noop}
      onUndo={noop}
      onClose={noop}
      {...props}
    />,
  );

test("いま何番目の一致かを常に出す", () => {
  expect(render()).toContain("3/12");
});

test("置換行は開いたときだけ出す (狭い画面で本文を潰さない)", () => {
  expect(render()).not.toContain("すべて");
  const opened = render({ showReplace: true });
  expect(opened).toContain("すべて");
  expect(opened).toContain('aria-label="置換後の文字"');
});

test("すべて置換のボタンに件数を出す (押す前に規模が判る)", () => {
  expect(render({ showReplace: true })).toContain("すべて (12)");
});

test("0 件のときは件数を「0 件」にして、送りも置換も押せない", () => {
  const html = render({ count: { total: 0, current: 0 }, showReplace: true });
  expect(html).toContain("0 件");
  // ∧ ∨ 置換 すべて の 4 つ
  expect(html.match(/disabled=""/g)).toHaveLength(4);
});

test("検索語が空なら件数を出さない (打ち始める前に 0 件と言わない)", () => {
  const html = render({ search: "", count: { total: 0, current: 0 } });
  expect(html).not.toContain("0 件");
});

test("一致の上にいなければ番号は「-」(本文を直した直後)", () => {
  expect(render({ count: { total: 12, current: 0 } })).toContain("-/12");
});

test("置換の知らせには「元に戻す」を添える (確認ダイアログの代わり)", () => {
  const html = render({ note: { text: "12 件置換しました", undo: true } });
  expect(html).toContain("12 件置換しました");
  expect(html).toContain("元に戻す");
});

test("知らせが上限超えなら「元に戻す」は出さない (戻す物が無い)", () => {
  const html = render({
    note: { text: "置換すると上限を超えます", undo: false },
  });
  expect(html).toContain("置換すると上限を超えます");
  expect(html).not.toContain("元に戻す");
});
