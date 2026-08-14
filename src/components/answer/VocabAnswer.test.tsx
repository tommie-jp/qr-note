import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { VocabAnswer } from "./VocabAnswer";

// 本番 #1128 の 1 語ぶん
const ANSWER = "/kənˈsaɪs/ 簡潔な、要領を得た His answer was concise and clear.";

const countButtons = (html: string) => html.split("<button").length - 1;

test("単語と例文の 2 つに発音ボタンを出す", () => {
  // Arrange / Act
  const html = renderToStaticMarkup(
    <VocabAnswer text={ANSWER} word="concise" />,
  );

  // Assert
  expect(countButtons(html)).toBe(2);
  expect(html).toContain('aria-label="concise の発音を再生"');
  expect(html).toContain('aria-label="例文を再生"');
});

test("答えの文字を 1 つも落とさずに描く", () => {
  // Arrange / Act
  const text = renderToStaticMarkup(
    <VocabAnswer text={ANSWER} word="concise" />,
  ).replace(/<[^>]*>/g, "");

  // Assert
  expect(text).toBe(ANSWER);
});

test("例文が無ければ単語のボタンだけ出す", () => {
  // Arrange / Act
  const html = renderToStaticMarkup(
    <VocabAnswer text="/ˈsʌtl/ 微妙な、繊細な" word="subtle" />,
  );

  // Assert
  expect(countButtons(html)).toBe(1);
  expect(html).toContain('aria-label="subtle の発音を再生"');
});

test("見出し語を取れなければ例文のボタンだけ出す", () => {
  // Arrange / Act
  const html = renderToStaticMarkup(<VocabAnswer text={ANSWER} word={null} />);

  // Assert
  expect(countButtons(html)).toBe(1);
  expect(html).toContain('aria-label="例文を再生"');
});

test("単語帳でない答えは素の文字のまま (ボタンを出さない)", () => {
  // Arrange
  const answer = "動 ～に感染させる；infection 名 感染(症)";

  // Act
  const html = renderToStaticMarkup(<VocabAnswer text={answer} word={null} />);

  // Assert
  expect(countButtons(html)).toBe(0);
  expect(html).toBe(answer.replace(/&/g, "&amp;"));
});
