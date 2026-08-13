import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MatrixTable } from "./MatrixTable";
import type { MatrixResult } from "@/lib/matrixData";
import type { MatrixTableData } from "@/lib/matrixTable";

const TABLE: MatrixTableData = {
  kind: "checks",
  columns: ["学習済み", "自信あり"],
  rows: [
    { itemNo: "4551", summary: "問1", cells: ["checked", "checked"] },
    { itemNo: "4552", summary: "問2", cells: ["checked", "unchecked"] },
    { itemNo: "4553", summary: "問3", cells: ["unchecked", "absent"] },
  ],
  total: 3,
  done: [2, 1],
  omitted: 0,
  columnsOmitted: 0,
};

function render(result: MatrixResult, code = "#電験三種"): string {
  return renderToStaticMarkup(<MatrixTable result={result} code={code} />);
}

const tableResult = (table: MatrixTableData): MatrixResult => ({
  kind: "table",
  table,
  query: "#電験三種",
  sort: "itemNo",
  marks: null,
});

describe("MatrixTable", () => {
  test("列の見出しと行が出る", () => {
    const html = render(tableResult(TABLE));
    expect(html).toContain("学習済み");
    expect(html).toContain("自信あり");
    expect(html).toContain("#4551");
    expect(html).toContain("問3");
  });

  // 表を開く目的は「どれがまだか」を一目で見ること。名前が先だと、狭い画面で
  // 真っ先に潰れるはずの名前が場所を先取りする
  test("チェックの列がノートより先に出る", () => {
    const html = render(tableResult(TABLE));
    const headers = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, ""),
    );
    expect(headers).toEqual(["学習済み", "自信あり", "ノート"]);
    // 行の中も同じ並び (セル → リンク)
    expect(html.indexOf("✓")).toBeLessThan(html.indexOf("#4551"));
  });

  test("件数と、列ごとの率 + 実数を出す", () => {
    const html = render(tableResult(TABLE));
    expect(html).toContain("全 3 件");
    // 2/3 と 1/3。切り上げないので 66.6 / 33.3
    expect(html).toContain("学習済み 66.6% (2)");
    expect(html).toContain("自信あり 33.3% (1)");
  });

  // 列の幅を記号 1 文字まで狭めるため、名前は寝かせる
  test("チェックの列の見出しは 90° 反時計回りに寝かせる", () => {
    const html = render(tableResult(TABLE));
    expect(html).toContain("-rotate-90");
    // transform はレイアウトの箱を変えないので高さを自分で確保する
    // (いちばん長い名前 4 文字 + 余白 = 5em)
    expect(html).toContain("height:5em");
    // ノートの見出しは寝かせない
    expect(html).toMatch(/<th[^>]*>ノート<\/th>/);
  });

  // mark= で記号を差し替える。読み上げ文は差し替えない
  test("mark= の記号に差し替える (読み上げ文は 済/未 のまま)", () => {
    const html = renderToStaticMarkup(
      <MatrixTable
        result={{
          kind: "table",
          table: TABLE,
          query: "#電験三種",
          sort: "itemNo",
          marks: { unchecked: "🟥", checked: "✅️", absent: "➖" },
        }}
        code="#電験三種"
      />,
    );
    expect(html).toContain("🟥");
    expect(html).toContain("✅️");
    expect(html).toContain("➖");
    expect(html).not.toContain("✓");
    expect(html).not.toContain("☐");
    // 読み上げ文は日本語のまま
    expect(html).toContain("済");
    expect(html).toContain("項目なし");
  });

  test("済みは緑、未は赤、項目なしは薄い灰色", () => {
    const html = render(tableResult(TABLE));
    expect(html).toContain("text-emerald-600");
    expect(html).toContain("text-red-600");
    expect(html).toContain("text-gray-300");
  });

  // 表から開いた先で前後ナビが出るように、検索式と並びをリンクへ載せる
  // (docs/60-学習進捗計画.md §4)
  test("行のリンクに検索式と並びが載る", () => {
    const html = render(tableResult(TABLE));
    expect(html).toContain("/item/4551?q=%23%E9%9B%BB%E9%A8%93%E4%B8%89%E7%A8%AE");
    expect(html).toContain("sort=itemNo");
  });

  // 記号だけだと読み上げが済 / 未 / 項目なし を区別できない
  test("セルは記号と読み上げ文の両方を持つ", () => {
    const html = render(tableResult(TABLE));
    expect(html).toContain("✓");
    expect(html).toContain("☐");
    expect(html).toContain("項目なし");
  });

  test("状態 1 列のときは 3 状態の言葉が出る", () => {
    const html = render(
      tableResult({
        kind: "status",
        columns: ["状態"],
        rows: [
          { itemNo: "4551", summary: "問1", cells: ["mastered"] },
          { itemNo: "4552", summary: "問2", cells: ["learning"] },
          { itemNo: "4553", summary: "問3", cells: ["untouched"] },
        ],
        total: 3,
        done: [1],
        omitted: 0,
        columnsOmitted: 0,
      }),
    );
    expect(html).toContain("習得");
    expect(html).toContain("学習中");
    expect(html).toContain("未着手");
    // 3 状態も緑 / 黄 / 赤で出し分ける
    expect(html).toContain("text-emerald-600");
    expect(html).toContain("text-amber-600");
    expect(html).toContain("text-red-600");
  });

  test("溢れた件数を知らせる (黙って打ち切らない)", () => {
    const html = render(tableResult({ ...TABLE, omitted: 7 }));
    expect(html).toContain("他 7 件");
  });

  // col= を省いて本文から拾ったとき、上限を超えた列があることを言う
  test("載せなかった列の数も知らせる", () => {
    const html = render(tableResult({ ...TABLE, columnsOmitted: 2 }));
    expect(html).toContain("他 2 種類のチェック");
    expect(html).toContain("col=");
  });

  test("0 件のときは空の表ではなく文で出す", () => {
    const html = render(tableResult({ ...TABLE, rows: [], total: 0 }));
    expect(html).not.toContain("<table");
    expect(html).toContain("チェックを持つノートがありません");
  });

  test("書き方の誤りは元ソースを添えて出す", () => {
    const html = render(
      { kind: "error", error: "知らない設定「limit」です" },
      "#電験三種\nlimit=10",
    );
    expect(html).toContain("知らない設定");
    expect(html).toContain("limit=10");
  });
});
