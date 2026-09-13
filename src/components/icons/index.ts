// アイコンの入口。使う側は置き場のファイルではなく `@/components/icons` から読む。
//
// バレル (index.ts) はこのリポジトリでは作らない流儀だが、ここは例外の 1 つ
// (docs/93-リファクタリング計画.md §1)。もとは 1 本の MenuIcons.tsx で、
// 30 か所以上から import されている。置き場のファイルを割り直すたびに
// その import を書き換えずに済むよう、入口を 1 つに固定する。
//
// 土台 (primitives.tsx の StrokeIcon・TINT) はここから出さない — アイコンを
// 描くのは icons/ の中だけにして、同じ意味の絵が部品ごとに描き直されないようにする
export * from "./actions";
export * from "./bottomBar";
export * from "./editor";
export * from "./find";
export * from "./header";
export * from "./menu";
export * from "./note";
export * from "./search";
export * from "./thumb";
