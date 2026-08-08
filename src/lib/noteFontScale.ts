// 画面の文字サイズ (docs/61-テキストサイズ計画.md)。
//
// **画面ぜんぶに効く。** 当初は本文の器だけを大きくしていたが、一覧やタグの
// 文字も対象になった時点でその形は破綻する — 画面ごとにクラスを貼って回れば、
// 貼り忘れた場所だけ小さいままの「まだら」が必ず残るため。
//
// 効かせ方は html に立てる CSS 変数 1 つ (--note-font-scale)。globals.css の
// html { font-size: calc(100% * var(--note-font-scale)) } が受け、寸法が
// ほぼ rem で書かれているぶん (文字・余白・タップ目標・アイコン) が比率を
// 保ったまま一斉に伸縮する。ブラウザのズームと同じ挙動。
//
// 例外は 2 つだけ: 入力欄の 16px 下限と、rem に追随しない図 (どちらも
// globals.css 側に理由付きで置いてある)。
export const NOTE_FONT_SCALE_KEY = "note-font-scale";
export const NOTE_FONT_SCALE_VAR = "--note-font-scale";

// 段は離散にする。連続のスライダーは片手で狙いにくいうえ、「元に戻す」が
// 曖昧になる。
//
// 縮小方向 (75% / 85%) は**読む文字にだけ**効く。入力欄は globals.css が
// max(16px, 1em) で 16px を下限に留める — 16px 未満の入力欄は iOS Safari が
// フォーカス時に自動ズームして戻らないため。つまり縮小時は「読む文字は
// 小さく、書く文字は等倍のまま」になる。
//
// 75% ではタップ目標が 44px → 33px まで縮む。原則を割るが、意図して選ぶ段
// なので許容する (「もっと詰めて見たい」がその選択の中身そのもの)
export const NOTE_FONT_SCALES = [
  0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2,
] as const;

export const DEFAULT_NOTE_FONT_SCALE = 1;

// localStorage の値は誰でも書き換えられるうえ、段を後から変えれば古い端末に
// 知らない値が残る。**捨てずにいちばん近い段へ寄せる** — 「1.2 が保存されて
// いたら等倍に戻す」より「1.15 で開く」ほうが、利用者の意図に近い
export function normalizeNoteFontScale(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) {
    return DEFAULT_NOTE_FONT_SCALE;
  }
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    return DEFAULT_NOTE_FONT_SCALE;
  }
  return nearestScale(value);
}

function nearestScale(value: number): number {
  return NOTE_FONT_SCALES.reduce((nearest, scale) =>
    Math.abs(scale - value) < Math.abs(nearest - value) ? scale : nearest,
  );
}

// ＋ / − を 1 段動かす。端では動かない (押しても行き過ぎない)。
// ボタンの disabled もこの結果と突き合わせて決めるので、端の判断はここだけ
export function stepNoteFontScale(current: number, direction: 1 | -1): number {
  const index = NOTE_FONT_SCALES.indexOf(
    nearestScale(current) as (typeof NOTE_FONT_SCALES)[number],
  );
  const next = index + direction;
  if (next < 0 || next >= NOTE_FONT_SCALES.length) {
    return NOTE_FONT_SCALES[index];
  }
  return NOTE_FONT_SCALES[next];
}

export function noteFontScaleLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

// 初回描画の前に走らせるスクリプト (layout.tsx が <head> へ inline で置く)。
//
// useEffect で当てると、サーバが描いた等倍の本文が一度見えてから大きくなる。
// 「文字サイズを上げた人」は毎回その跳ねを見ることになるので、HTML の解析中に
// 同期で走るインラインスクリプトで当てる (Next の
// docs/01-app/02-guides/preventing-flash-before-hydration.md の theme と同じ手)。
//
// **寄せ方は normalizeNoteFontScale と同じにすること。** import できない
// (バンドル前に走る) ので実装は二重になる。ずれると読み込み直後だけ別の
// 大きさで描かれるため、noteFontScale.test.ts が両方を同じ表で確かめている。
//
// 等倍のときは何も書かない。CSS 側の既定 (var の第 2 引数) と同じなので、
// html に style を足す意味がない
export const NOTE_FONT_SCALE_INIT_SCRIPT = `(function(){try{var r=localStorage.getItem(${JSON.stringify(
  NOTE_FONT_SCALE_KEY,
)});if(r===null)return;var n=parseFloat(r);if(!isFinite(n))return;var s=${JSON.stringify(
  NOTE_FONT_SCALES,
)},c=s[0];for(var i=1;i<s.length;i++){if(Math.abs(s[i]-n)<Math.abs(c-n))c=s[i]}if(c!==${JSON.stringify(
  DEFAULT_NOTE_FONT_SCALE,
)})document.documentElement.style.setProperty(${JSON.stringify(
  NOTE_FONT_SCALE_VAR,
)},String(c))}catch(e){}})()`;
