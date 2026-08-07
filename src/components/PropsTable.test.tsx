import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ItemPropsRow } from "@/lib/props";
import { PropsTable } from "./PropsTable";

const rows: ItemPropsRow[] = [
  {
    itemNo: "4951",
    summary: "2SC2712-Y",
    props: [
      { key: "hfe", label: "hFE", value: "208" },
      { key: "vf", label: "Vf", value: "700mV" },
    ],
  },
  {
    itemNo: "4924",
    summary: "2SC1815",
    props: [
      { key: "hfe", label: "hFE", value: "440" },
      { key: "vce", label: "Vce", value: "50V" },
    ],
  },
];

const html = () => renderToStaticMarkup(<PropsTable rows={rows} query="" sort="updated" />);

describe("PropsTable", () => {
  test("renders a header for each property key in the result set", () => {
    const out = html();
    expect(out).toContain("hFE");
    expect(out).toContain("Vf");
    expect(out).toContain("Vce");
  });

  test("renders the values as written", () => {
    const out = html();
    expect(out).toContain("208");
    expect(out).toContain("700mV");
    expect(out).toContain("50V");
  });

  test("links each row to its item page", () => {
    const out = html();
    expect(out).toContain('href="/item/4951"');
    expect(out).toContain('href="/item/4924"');
  });

  test("shows the memo summary as the device name", () => {
    expect(html()).toContain("2SC2712-Y");
  });

  test("marks a missing value instead of leaving the cell blank", () => {
    // 4951 は Vce を持たない。
    expect(html()).toContain("—");
  });

  test("renders nothing when there are no rows", () => {
    expect(renderToStaticMarkup(<PropsTable rows={[]} query="" sort="updated" />)).toBe("");
  });

  test("says nothing about omitted rows when the table is complete", () => {
    expect(html()).not.toContain("表に載せていません");
  });

  // 黙って打ち切ると「これで全部」と読めてしまう。
  test("tells the reader when rows were left out", () => {
    const out = renderToStaticMarkup(<PropsTable rows={rows} omitted={7} query="" sort="updated" />);
    expect(out).toContain("他 7 件は表に載せていません");
  });

  test("renders nothing when no row has properties", () => {
    const empty: ItemPropsRow[] = [{ itemNo: "1", summary: "a", props: [] }];
    expect(renderToStaticMarkup(<PropsTable rows={empty} query="" sort="updated" />)).toBe("");
  });
});
