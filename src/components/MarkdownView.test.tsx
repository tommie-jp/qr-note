import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { MarkdownView } from "./MarkdownView";

// 画像 (ZoomableImage) が回転確定後の router.refresh() のために useRouter を
// 呼ぶ。renderToStaticMarkup には App Router のコンテキストが無く useRouter が
// 投げるので、ここだけ差し替える (ZoomableImage.test.tsx と同じ)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const render = (markdown: string) =>
  renderToStaticMarkup(<MarkdownView markdown={markdown} />);

test("見出し・リストを HTML にレンダリングする", () => {
  const html = render("# タイトル\n\n- 項目1\n- 項目2");
  expect(html).toContain("<h1>タイトル</h1>");
  expect(html).toContain("<li>項目1</li>");
});

test("裸の URL を自動リンクにする (GFM)", () => {
  const html = render("詳しくは https://example.com/x を参照");
  expect(html).toContain('href="https://example.com/x"');
});

test("単一改行を改行として表示する (breaks)", () => {
  const html = render("5V - 3A\n9V - 3A");
  expect(html).toContain("<br/>");
});

test("circuitikz フェンスは描画済み SVG に差し替える", () => {
  const code = "\\draw (0,0) to[R=$R_1$] (2,0);";
  const html = renderToStaticMarkup(
    <MarkdownView
      markdown={"```circuitikz\n" + code + "\n```"}
      circuits={new Map([[code, { svg: "<svg><path d='M0 0'/></svg>" }]])}
    />,
  );
  expect(html).toContain("circuit-diagram");
  expect(html).toContain("<path");
  expect(html).not.toContain("<code");
});

test("circuitikz の描画エラーは TeX ログとソースを添えて赤枠で出す", () => {
  const code = "\\draw (0,0) to[NOPE] (2,0);";
  const html = renderToStaticMarkup(
    <MarkdownView
      markdown={"```circuitikz\n" + code + "\n```"}
      circuits={
        new Map([
          [code, { error: "回路図を描画できませんでした", texLog: "! Package pgfkeys Error" }],
        ])
      }
    />,
  );
  expect(html).toContain("回路図を描画できませんでした");
  expect(html).toContain("! Package pgfkeys Error");
  expect(html).toContain("to[NOPE]");
});

// circuits を渡さないページ (docs など) で図が消えたりせず、素直にコードで出る
test("circuits を渡さなければ circuitikz はコードブロックのまま", () => {
  const html = render("```circuitikz\n\\draw (0,0) to[R] (2,0);\n```");
  expect(html).toContain("<code");
  expect(html).not.toContain("circuit-diagram");
});

test("mermaid フェンスはコードブロックではなく図として扱う", () => {
  const html = render("```mermaid\ngraph TD; A-->B;\n```");
  expect(html).toContain("mermaid-diagram");
  expect(html).not.toContain("<code");
});

test("mermaid 以外のコードフェンスはコードブロックのまま", () => {
  const html = render("```bash\nls -la\n```");
  expect(html).toContain("<code");
  expect(html).not.toContain("mermaid-diagram");
});

// docs/58-CBT問題集計画.md §1。図と違い渡すものは無く、本文だけで完結する
test("quiz フェンスは押せる問題カードにする", () => {
  const html = render(
    "```quiz\n問: 時定数は。\n1. $RC$\n2. $L/R$\n正解: 1\n解説: 定義から。\n```",
  );
  expect(html).toContain("時定数は。");
  expect(html).toContain("<button");
  expect(html).not.toContain("<code");
  // 解答するまで正解も解説も出さない。解説の**中身**で見るのは、
  // 「解説」の 2 文字が降参ボタン (解説を見る) にも入るため
  expect(html).not.toContain("定義から");
});

test("quiz フェンスの書き方の誤りは赤枠で知らせる", () => {
  const html = render("```quiz\nこれは問題ではない\n```");
  expect(html).toContain("問題の書き方のエラー");
  expect(html).toContain("これは問題ではない");
});

test("hast の node prop を DOM に漏らさない", () => {
  const html = render("[link](https://example.com)\n\n```bash\nls\n```");
  expect(html).not.toContain("node=");
});

test("生の HTML (script) は出力しない", () => {
  const html = render('<script>alert("x")</script>ほげ');
  expect(html).not.toContain("<script");
});

test("インライン数式 $...$ を KaTeX でレンダリングする", () => {
  const html = render("質量エネルギーは $E = mc^2$ で表せる");
  expect(html).toContain('class="katex"');
  expect(html).not.toContain("$E = mc^2$");
});

test("ブロック数式 $$...$$ を display モードでレンダリングする", () => {
  const html = render("$$\n\\int_0^1 x^2 dx\n$$");
  expect(html).toContain("katex-display");
});

test("ブロック数式は <pre> に包まれない", () => {
  const html = render("$$\nx + y\n$$");
  expect(html).not.toContain("<pre");
});

test("数式の巨大サイズ指定は maxSize で頭打ちになる", () => {
  const html = render("$\\rule{99999em}{99999em}$");
  expect(html).toContain("height:50em");
  expect(html).not.toContain("height:99999em");
});

test("閉じの $ がない単独の $ はそのまま表示する", () => {
  const html = render("価格は $100 です");
  expect(html).not.toContain("katex");
  expect(html).toContain("$100");
});

test("\\$ でエスケープすると数式扱いしない", () => {
  const html = render("価格は \\$100 と \\$200 です");
  expect(html).not.toContain("katex");
  expect(html).toContain("$100");
});

test("alt 末尾の |数字 を画像の幅として解釈する", () => {
  const html = render("![|200](/api/images/a.png)");
  expect(html).toContain('width="200"');
  expect(html).not.toContain("|200");
});

test("alt 本文と |数字 を併用できる", () => {
  const html = render("![スクショ|200](/api/images/a.png)");
  expect(html).toContain('alt="スクショ"');
  expect(html).toContain('width="200"');
});

test("幅指定なしの画像は alt をそのまま表示し width を付けない", () => {
  const html = render("![スクショ](/api/images/a.png)");
  expect(html).toContain('alt="スクショ"');
  expect(html).not.toContain("width=");
});

test("末尾が数字でない | は幅指定として扱わない", () => {
  const html = render("![a|b](/api/images/a.png)");
  expect(html).toContain('alt="a|b"');
  expect(html).not.toContain("width=");
});

// 動画も同じ記法で幅を指定できる (docs/73-動画幅指定計画.md)。画像と違い
// **上限**として効く — <video> は既定で全幅に伸びるので、固定幅にすると
// 画面より広い指定で横スクロールが生える
test("alt 末尾の |数字 を動画の表示幅の上限として解釈する", () => {
  const html = render("![録画|300](/api/images/a.mp4)");
  expect(html).toContain("<video");
  expect(html).toContain("max-width:300px");
  expect(html).not.toContain("max-w-md");
});

test("幅指定なしの動画は従来どおり max-w-md のまま", () => {
  const html = render("![録画](/api/images/a.mp4)");
  expect(html).toContain("<video");
  expect(html).toContain("max-w-md");
  expect(html).not.toContain("max-width");
});

// 幅を剥がしたラベルが共有・保存のファイル名になる (剥がさないと
// 「録画|300.mp4」で保存される)
test("動画の保存名に幅記法を混ぜない", () => {
  const html = render("![録画|300](/api/images/a.mp4)");
  expect(html).toContain('download="録画.mp4"');
  expect(html).not.toContain("|300");
});

test("末尾が数字でない | は動画でも幅指定として扱わない", () => {
  const html = render("![a|b](/api/images/a.mp4)");
  expect(html).toContain('download="a|b.mp4"');
  expect(html).not.toContain("max-width");
});

// 音声 (docs/12-添付ファイル種類拡張メモ.md)。エディタは音声を ![audio](url)
// で挿入し、レンダラは src の拡張子を見て <audio> に振り分ける
test("音声 URL の画像記法は <audio> プレイヤーにする", () => {
  const html = render("![audio](/api/images/abc.mp3)");
  expect(html).toContain("<audio");
  expect(html).toContain('src="/api/images/abc.mp3"');
  expect(html).toContain("controls");
  // 画像 (<img>) にはしない
  expect(html).not.toContain("<img");
  // 勝手に鳴らさない
  expect(html).not.toContain("autoplay");
});

test.each(["mp3", "m4a", "wav", "webm"])("%s も <audio> にする", (ext) => {
  const html = render(`![audio](/api/images/x.${ext})`);
  expect(html).toContain("<audio");
});

// 録音は alt に日時を残す (MemoEditorInner の recordingAltText)。
// alt が "audio" でなくても振り分けは src の拡張子で決まる
test("録音の画像記法 (alt が録音日時) も <audio> にする", () => {
  const html = render("![録音 2026-07-20 14:03:09](/api/images/abc.webm)");
  expect(html).toContain("<audio");
  expect(html).toContain('src="/api/images/abc.webm"');
  expect(html).not.toContain("<img");
});

test("画像 URL は従来どおり <img> のまま (音声に巻き込まれない)", () => {
  const html = render("![](/api/images/a.png)");
  expect(html).toContain("<img");
  expect(html).not.toContain("<audio");
});

// PDF (docs/12-添付ファイル種類拡張メモ.md)。押すとページ内のビューアで開く
// (画面遷移させない。standalone PWA で戻れなくなるため。PdfLink.tsx 参照)
test("PDF URL の画像記法はビューアを開くボタンにする", () => {
  const html = render("![仕様書.pdf](/api/images/abc.pdf)");
  expect(html).toContain('<button type="button"');
  expect(html).toContain("仕様書.pdf");
  // PDF へ直接遷移する導線は本文に置かない
  expect(html).not.toContain('href="/api/images/abc.pdf"');
  // 画像でも音声でもない
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<audio");
});

test("PDF の alt が空でも既定のラベルを出す", () => {
  const html = render("![](/api/images/abc.pdf)");
  expect(html).toContain('<button type="button"');
  expect(html).toContain("PDF");
});

// テキスト系 (docs/12-添付ファイル種類拡張メモ.md)。PDF と同じく
// ページ内のビューアで開く (画面遷移させない)
test.each(["txt", "csv", "md"])("%s の画像記法はビューアを開くボタンにする", (ext) => {
  const html = render(`![資料.${ext}](/api/images/abc.${ext})`);
  expect(html).toContain('<button type="button"');
  expect(html).toContain(`資料.${ext}`);
  expect(html).not.toContain(`href="/api/images/abc.${ext}"`);
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<audio");
});

test("テキストの alt が空でも既定のラベルを出す", () => {
  const html = render("![](/api/images/abc.txt)");
  expect(html).toContain('<button type="button"');
  expect(html).toContain("テキスト");
});

// webp は md/txt/csv と字面が近いので、巻き込まれていないことを明示する
// (ZoomableImage 自身が拡大用の button を持つので、判定は <img> の有無で行う)
test("画像 URL は従来どおり <img> のまま (テキストに巻き込まれない)", () => {
  const html = render("![](/api/images/a.webp)");
  expect(html).toContain("<img");
  expect(html).not.toContain("📝");
});

test("本文中の #タグ を検索リンクにする", () => {
  const html = render("これは #抵抗 のメモ");
  expect(html).toContain(`href="/?q=${encodeURIComponent("#抵抗")}"`);
  expect(html).toContain(">#抵抗</a>");
});

test("#タグ のリンク先は正規化名だが表示は元の綴り", () => {
  const html = render("#ＮＰＮ トランジスタ");
  expect(html).toContain(`href="/?q=${encodeURIComponent("#npn")}"`);
  expect(html).toContain(">#ＮＰＮ</a>");
});

test("コードブロック内の #tag はリンクにしない", () => {
  const html = render("```bash\ngrep '#tag'\n```");
  expect(html).not.toContain("/?q=");
});

test("見出しの # はタグリンクにしない", () => {
  const html = render("# 見出し");
  expect(html).toContain("<h1>見出し</h1>");
  expect(html).not.toContain("/?q=");
});

test("外部リンクは別タブで開く", () => {
  const html = render("[例](https://example.com/x)");
  expect(html).toContain('target="_blank"');
});

test("裸の URL の自動リンクも別タブで開く", () => {
  const html = render("詳しくは https://example.com/x を参照");
  expect(html).toContain('target="_blank"');
});

// 検索やメモへの遷移まで別タブになるとタブが増えて使いにくい
test("アプリ内リンクは同じタブで開く", () => {
  const html = render("[メモ](/items/42)");
  expect(html).not.toContain('target="_blank"');
});

test("#タグ の検索リンクは同じタブで開く", () => {
  const html = render("これは #抵抗 のメモ");
  expect(html).not.toContain('target="_blank"');
});

// 別タブを開いてもメーラーが起動するだけで空タブが残る
test("mailto リンクは別タブにしない", () => {
  const html = render("[連絡](mailto:a@example.com)");
  expect(html).not.toContain('target="_blank"');
});

// 公開ビュー (docs/22-ノート公開計画.md §4)。タグ検索は未ログインに閉じて
// いるので、公開ノートの本文に「押すと案内に化けるリンク」を残さない。
// タグの**文字は本文の一部なので消さない** — リンクにしないだけ
test("linkTags=false で #タグ をリンクにしない (文字は残す)", () => {
  const html = renderToStaticMarkup(
    <MarkdownView markdown="これは #抵抗 のメモ" linkTags={false} />,
  );

  expect(html).not.toContain("q=%23");
  expect(html).not.toContain("<a ");
  expect(html).toContain("#抵抗");
});

// 既定は従来どおり (持ち主の画面が壊れていないこと)
test("既定では #タグ を検索リンクにする", () => {
  const html = render("これは #抵抗 のメモ");
  expect(html).toContain("q=%23");
});

// シークレット断片内の画像は、復号したバイト列から作った blob: URL に
// 差し替えて描く (docs/51-部分暗号化計画.md §9)。react-markdown の既定の
// urlTransform は https 等しか通さず blob: を空文字に潰すため、明示的に
// 通している — ここが落ちると画像の代わりに alt 文字だけが出る (実機で発生)
test("blob: URL の画像を src を保ったまま描く (シークレット断片内の画像)", () => {
  const html = render("![画像](blob:https://example.com/123-abc)");
  expect(html).toContain('src="blob:https://example.com/123-abc"');
});

test("blob: 以外の未知プロトコルは今までどおり潰す", () => {
  const html = render("![x](javascript:alert(1))");
  expect(html).not.toContain("javascript:");
});

// シークレット断片の「編集」は保存を伴うので、ノート閲覧 (ItemView) から
// 渡されたときだけ出す (docs/52-シークレット編集導線計画.md §2)。
// 公開ビュー・印刷・docs ページでは既定の false のまま出さない
const SECRET_MD = "![住所](/api/secrets/0123abcd-4567-89ab-cdef-0123456789ab)";

test("シークレットは既定では編集ボタンを出さない (公開ビュー・印刷)", () => {
  expect(render(SECRET_MD)).not.toContain("編集");
});

test("シークレットのラベルは施錠中でも本文に出る (中身は出ない)", () => {
  const html = render(SECRET_MD);
  expect(html).toContain("住所");
  // 暗号文の URL を <img src> として描かない (割れた画像になるため)
  expect(html).not.toContain('src="/api/secrets/');
});

// シークレット断片の中の音声・動画は復号した Blob URL になり、拡張子を
// 持たない。種別の対応表で描き分ける (docs/53-シークレット挿入拡張計画.md §5)
test("blobKinds で音声・動画のプレイヤーに振り分ける", () => {
  const audio = "blob:https://example.com/a";
  const video = "blob:https://example.com/v";
  const html = renderToStaticMarkup(
    <MarkdownView
      markdown={`![録音](${audio})\n\n![録画](${video})`}
      blobKinds={
        new Map<string, "image" | "audio" | "video">([
          [audio, "audio"],
          [video, "video"],
        ])
      }
    />,
  );
  expect(html).toContain("<audio");
  expect(html).toContain("<video");
});

// 復号した動画 (Blob URL) にも同じ幅記法が効く。シークレットのラベルは
// 平文で本文に残るので、幅を書けるのは通常の動画と同じ (docs/73 §3)
test("blobKinds の動画にも alt の幅指定が効く", () => {
  const video = "blob:https://example.com/v";
  const html = renderToStaticMarkup(
    <MarkdownView
      markdown={`![録画|300](${video})`}
      blobKinds={new Map<string, "image" | "audio" | "video">([[video, "video"]])}
    />,
  );
  expect(html).toContain("<video");
  expect(html).toContain("max-width:300px");
  expect(html).not.toContain("|300");
});

test("blobKinds に無い blob: は今までどおり画像として描く", () => {
  const html = render("![図](blob:https://example.com/x)");
  expect(html).toContain('src="blob:https://example.com/x"');
  expect(html).not.toContain("<audio");
});

// --- タスクリストのチェックボックス (docs/55-チェックボックス操作計画.md) ---

const noopToggle = async () => {};

const renderWithToggle = (markdown: string) =>
  renderToStaticMarkup(
    <MarkdownView
      markdown={markdown}
      onToggleTask={noopToggle}
    />,
  );

test("onToggleTask を渡さないとチェックボックスは押せないまま", () => {
  const html = render("- [ ] apple\n- [x] banana");
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("disabled");
});

test("onToggleTask を渡すと押せるチェックボックスに差し替える", () => {
  const html = renderWithToggle("- [ ] apple\n- [x] banana");
  expect(html).toContain('type="checkbox"');
  expect(html).not.toContain("disabled");
  // 描画時点の状態がそのまま出る (2 つ目だけチェック済み)
  expect(html.match(/checked/g)).toHaveLength(1);
});

test("コードフェンスの中の擬似タスクはチェックボックスにならない", () => {
  const html = renderWithToggle("```text\n- [ ] apple\n```");
  expect(html).not.toContain('type="checkbox"');
});

// --- コードブロックのコピーボタン (docs/54-markdown表示拡張計画.md §1) ---

const COPY_LABEL = "コードをコピー";

test("コードフェンスにコピーボタンを添える", () => {
  const html = render("```bash\nls -la\n```");
  expect(html).toContain(COPY_LABEL);
  expect(html).toContain("<code");
});

test("言語指定のないフェンスにもコピーボタンを添える", () => {
  expect(render("```\nls -la\n```")).toContain(COPY_LABEL);
});

test("字下げのコードブロックにもコピーボタンを添える", () => {
  expect(render("    ls -la")).toContain(COPY_LABEL);
});

// 図はコピーしても意味のある文字にならない
test("mermaid の図にはコピーボタンを出さない", () => {
  expect(render("```mermaid\ngraph TD; A-->B;\n```")).not.toContain(COPY_LABEL);
});

test("描画済みの回路図にはコピーボタンを出さない", () => {
  const code = "\\draw (0,0) to[R] (2,0);";
  const html = renderToStaticMarkup(
    <MarkdownView
      markdown={"```circuitikz\n" + code + "\n```"}
      circuits={new Map([[code, { svg: "<svg></svg>" }]])}
    />,
  );
  expect(html).not.toContain(COPY_LABEL);
});

test("印刷にはコピーボタンを出さない", () => {
  expect(render("```bash\nls\n```")).toContain("print:hidden");
});

// --- アラート (docs/54-markdown表示拡張計画.md §2) ---

test("[!WARNING] を注意書きの枠にする", () => {
  const html = render("> [!WARNING]\n> 火傷に注意");
  expect(html).toContain("注意");
  expect(html).toContain("火傷に注意");
  expect(html).not.toContain("[!WARNING]");
});

test("知らない種類の [!FOO] はただの引用にする", () => {
  const html = render("> [!FOO]\n> 本文");
  expect(html).toContain("<blockquote>");
  expect(html).toContain("[!FOO]");
});

test("アラートの中の #タグ もリンクになる", () => {
  const html = render("> [!NOTE]\n> #抵抗 のこと");
  expect(html).toContain("q=%23");
});

// --- 脚注 (docs/54-markdown表示拡張計画.md §3) ---

const FOOTNOTE_MD = "本文[^1]\n\n[^1]: 補足の説明";

// 参照リンクの飛び先と脚注の id が食い違うと、押しても何も起きない。
// remark-rehype と rehype-sanitize が**二重に** user-content- を付けるのが
// 原因で、静かに壊れる (見た目は脚注が出ているので気づけない)
test("脚注の参照と飛び先の id が一致する", () => {
  const html = render(FOOTNOTE_MD);
  const href = /href="#([^"]*fn-1[^"]*)"/.exec(html)?.[1];
  expect(href).toBeDefined();
  expect(html).toContain(`id="${href}"`);
});

test("脚注の戻りリンクの飛び先も一致する", () => {
  const html = render(FOOTNOTE_MD);
  const href = /href="#([^"]*fnref-1[^"]*)"/.exec(html)?.[1];
  expect(href).toBeDefined();
  expect(html).toContain(`id="${href}"`);
});

test("id に user-content- を二重に付けない", () => {
  expect(render(FOOTNOTE_MD)).not.toContain("user-content-user-content-");
});

test("脚注の見出しを日本語にする", () => {
  const html = render(FOOTNOTE_MD);
  expect(html).toContain("脚注");
  expect(html).not.toContain("Footnotes");
});

test("脚注の本文を最後にまとめて出す", () => {
  const html = render(FOOTNOTE_MD);
  expect(html).toContain("補足の説明");
  expect(html).toContain("<section");
});

// 区切り線は wrapper の [&_.footnotes] で引くので、この class が
// サニタイズで落ちると線だけ静かに消える
test("脚注の塊に footnotes クラスが残る (区切り線の目印)", () => {
  expect(render(FOOTNOTE_MD)).toContain('class="footnotes"');
});

// --- 折りたたみ (docs/54-markdown表示拡張計画.md §4) ---

test(":::details を折りたたみにする", () => {
  const html = render(":::details[長いログ]\n本文\n:::");
  expect(html).toContain("<details");
  expect(html).toContain("<summary>長いログ</summary>");
  expect(html).toContain("本文");
});

// サニタイズが details/summary を落とすと中身ごと消える
test("折りたたみはサニタイズを通り抜ける", () => {
  const html = render(":::details[x]\n畳んだ中身\n:::");
  expect(html).toContain("畳んだ中身");
});

test("折りたたみの中の画像も描く", () => {
  const html = render(":::details[図]\n![|200](/api/images/a.png)\n:::");
  expect(html).toContain('width="200"');
});

test("知らない directive は書いたとおりの文字で残す", () => {
  expect(render("型:int です")).toContain("型:int です");
});

// ページ 2 枚目以降を描くときの行番号 (docs/74-ページ計画.md §4)。
// 刻むのは本文全体に対する行番号 — ページの中の番号を渡すと、
// toggleMemoTaskAction が別の行を反転させる
test("チェックボックスに本文の行番号を刻む", () => {
  expect(render("- [ ] やること")).toContain('data-line="1"');
});

test("lineOffset を足した行番号を刻む", () => {
  const html = renderToStaticMarkup(
    <MarkdownView markdown="- [ ] やること" lineOffset={3} />,
  );
  expect(html).toContain('data-line="4"');
});

// 空行を挟んだチェックリスト (loose list) は各項目が <p> で包まれ、prose の
// 段落余白で行間が空行なしの倍以上になる (docs/55-チェックボックス操作計画.md §8)。
// 同じノートの中で書き方によって行間が食い違うのを止める
test("空行を挟んだチェックリストは <p> で包まれる", () => {
  const html = render("- [ ] 高野豆腐\n\n- [ ] レモン汁");
  expect(html).toContain("<li class=\"task-list-item\">\n<p>");
});

// class 属性なので > は &gt; に escape されて出る
test("タスク項目の段落は外側の余白を落とす", () => {
  const html = render("- [ ] 高野豆腐");
  expect(html).toContain("[&amp;_li.task-list-item&gt;p:first-child]:mt-0");
  expect(html).toContain("[&amp;_li.task-list-item&gt;p:last-child]:mb-0");
});

// ```matrix (docs/77-進捗マトリックス計画.md §6)
//
// 表の中身はそのノートの外 — 非公開ノートの番号・タイトル・学習状況 — から
// 作られる。集計結果を渡さない画面 (未ログインの公開ビュー・docs ページ) では
// 決して表が出ないことを、ここで固定する
test("matrix フェンスは集計結果を渡さなければ表にならない", () => {
  const html = render("```matrix\n#電験三種\n```");
  expect(html).not.toContain("<table");
  expect(html).toContain("#電験三種");
  expect(html).toContain("<pre");
});

test("matrix フェンスは集計結果を渡すと表になる", () => {
  const code = "#電験三種";
  const html = renderToStaticMarkup(
    <MarkdownView
      markdown={"```matrix\n#電験三種\n```"}
      matrices={
        new Map([
          [
            code,
            {
              kind: "table" as const,
              query: "#電験三種",
              sort: "itemNo" as const,
              table: {
                kind: "checks" as const,
                columns: ["学習済み"],
                rows: [
                  {
                    itemNo: "4551",
                    summary: "問1",
                    cells: ["checked" as const],
                  },
                ],
                total: 1,
                done: [1],
                omitted: 0,
                columnsOmitted: 0,
              },
            },
          ],
        ])
      }
    />,
  );
  expect(html).toContain("<table");
  expect(html).toContain("#4551");
});

// 答え隠し `||答え||` (docs/79-答え隠し計画.md)
test("答え隠しは閉じた状態で描く (答えは DOM に出さない)", () => {
  const html = render("- [ ] infect ||動 ～に感染させる||");
  // 押す印だけが出て、答えの文字は無い (ソースからも読めない)
  expect(html).toContain("▶");
  expect(html).not.toContain("～に感染させる");
  expect(html).not.toContain("||");
  expect(html).toContain('aria-expanded="false"');
});

test("答え隠しは 1 行の中に収まる (行が割れない)", () => {
  const html = render("- [ ] infect ||訳||");
  // チェックボックスと単語と印が同じ <li> の中にある
  const li = /<li[^>]*>([\s\S]*?)<\/li>/.exec(html)?.[1] ?? "";
  expect(li).toContain("infect");
  expect(li).toContain("▶");
});

test("表の中の `||` は記法にしない (空セルのまま)", () => {
  const html = render("| a || b |\n| --- | --- | --- |\n| 1 | 2 | 3 |");
  expect(html).toContain("<table>");
  expect(html).not.toContain("▶");
});
