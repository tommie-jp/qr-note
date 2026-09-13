import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import * as icons from "@/components/icons";

// アイコンの描画結果を固定する (docs/93-リファクタリング計画.md §3-2)。
//
// icons.snapshot.json は **MenuIcons.tsx を割る前** と、部品の中に散っていた
// inline svg を icons/ へ回収する前に取った描画結果。分割・移動で svg の
// 属性や並びが 1 文字でも変われば、ここで落ちる。
//
// アイコンを足したときは `npx vitest run -u src/components/icons` で書き足す
// (差分に出るのは足したアイコンだけのはず — 既存の行が動いたら取り違え)。

// 小道具で描き分けるアイコンは、描き分けのある値をすべて並べる。
// ここに無いアイコンは小道具なし ({}) で 1 回だけ描く
const PROP_VARIANTS: Readonly<
  Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>
> = {
  // 検索窓の行 (SearchTools) は 20px に縮めて使う
  ScanIcon: [{}, { sizeClass: "size-5 shrink-0" }],
  ImageSearchIcon: [{}, { sizeClass: "size-5 shrink-0" }],
  TrashIcon: [{}, { small: true }],
  SpeakerIcon: [{ speaking: false }, { speaking: true }],
  PaneModeIcon: [{ mode: "3" }, { mode: "2" }, { mode: "1" }],
  TriangleIcon: [{ direction: "back" }, { direction: "forward" }],
  EyeIcon: [{ hidden: false }, { hidden: true }],
  MenuToggleIcon: [{ isOpen: false }, { isOpen: true }],
};

function caseName(name: string, props: Readonly<Record<string, unknown>>) {
  return Object.keys(props).length === 0
    ? name
    : `${name} ${JSON.stringify(props)}`;
}

function renderAllIcons(): Record<string, string> {
  const entries = Object.entries(icons).flatMap(([name, icon]) => {
    const Icon = icon as ComponentType<Record<string, unknown>>;
    return (PROP_VARIANTS[name] ?? [{}]).map(
      (props) =>
        [
          caseName(name, props),
          renderToStaticMarkup(createElement(Icon, props)),
        ] as const,
    );
  });
  // 並びは名前順に固定する。export の順 (= index.ts の並びとファイル内の
  // 並び) はアイコンの置き場を変えるだけで動くので、比べる対象にしない
  return Object.fromEntries(
    [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

test("どのアイコンも分割前と同じ svg を描く", async () => {
  const markup = `${JSON.stringify(renderAllIcons(), null, 2)}\n`;

  await expect(markup).toMatchFileSnapshot("./icons.snapshot.json");
});

// 表の名前を打ち間違える・アイコンを改名すると、描き分けが黙って {} の
// 1 回だけに減る。スナップショットからも行が消えるが、-u で上書きすると
// 気づけないので、表の側からも確かめる
test("描き分けの表に書いた名前はすべて icons から export されている", () => {
  const exported = new Set(Object.keys(icons));

  const unknown = Object.keys(PROP_VARIANTS).filter(
    (name) => !exported.has(name),
  );

  expect(unknown).toEqual([]);
});
