import Markdown from "react-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { BASE_REHYPE_PLUGINS, BASE_REMARK_PLUGINS } from "./markdownPipeline";
import { remarkAnswerSpoiler } from "./remarkAnswerSpoiler";
import { rehypeAnswerTts, ttsWordOf } from "./rehypeAnswerTts";
import { ANSWER_SPOILER_CLASS } from "@/lib/answerSpoiler";

// 本文と同じプラグイン列 (sanitize を含む) を通し、答えの span に刻まれた
// 見出し語を data-word として吐き出す。**sanitize の後で刻めているか**まで
// 見たいので、プラグインだけを単体で呼ばずに描画まで通す
const render = (markdown: string) =>
  renderToStaticMarkup(
    <Markdown
      remarkPlugins={[...BASE_REMARK_PLUGINS, remarkAnswerSpoiler]}
      rehypePlugins={[...BASE_REHYPE_PLUGINS, rehypeAnswerTts]}
      components={{
        span: ({ node, className, children }) =>
          className === ANSWER_SPOILER_CLASS ? (
            <span data-word={ttsWordOf(node) ?? ""}>{children}</span>
          ) : (
            <span className={className}>{children}</span>
          ),
      }}
    >
      {markdown}
    </Markdown>,
  );

test("チェックボックスと 🔊 リンクを挟んでも見出し語を刻む", () => {
  // Arrange — 本番 #1128 の 1 行をそのまま
  const line =
    "- [x] concise [🔊](https://dictionary.cambridge.org/dictionary/english/concise) " +
    "||/kənˈsaɪs/ 簡潔な、要領を得た His answer was concise and clear.||";

  // Act
  const html = render(line);

  // Assert
  expect(html).toContain('data-word="concise"');
});

test("飾りのない 1 行でも刻む", () => {
  // Arrange / Act
  const html = render("- [ ] mitigate ||/ˈmɪtɪɡeɪt/ 和らげる We took steps.||");

  // Assert
  expect(html).toContain('data-word="mitigate"');
});

test("見出し語が飾られていても刻む (強調・リンク)", () => {
  // Arrange / Act
  const bold = render("- [ ] **concise** ||/kənˈsaɪs/ 簡潔な||");
  const link = render("- [ ] [concise](https://example.com) ||/kənˈsaɪs/ 簡潔な||");

  // Assert
  expect(bold).toContain('data-word="concise"');
  expect(link).toContain('data-word="concise"');
});

test("1 行に答えが 2 つあれば、それぞれ直前の語を刻む", () => {
  // Arrange / Act
  const html = render("- [ ] concise ||答え1|| subtle ||答え2||");

  // Assert
  expect(html).toContain('data-word="concise"');
  expect(html).toContain('data-word="subtle"');
});

test("直前が英語でなければ刻まない (単語帳でない答え)", () => {
  // Arrange / Act
  const html = render("- [ ] オームの法則 ||V = IR||");

  // Assert
  expect(html).toContain('data-word=""');
});

test("答えが行頭にあれば刻まない", () => {
  // Arrange / Act
  const html = render("||答えだけの行||");

  // Assert
  expect(html).toContain('data-word=""');
});
