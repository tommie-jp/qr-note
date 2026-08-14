import { describe, expect, test } from 'vitest'
import { parseVocabAnswer, trailingHeadword } from './vocabTts'

// 本番 #1128「英単語 10 語」の答え (`||` の中身) をそのまま並べたもの。
// 実データを固定して、記法を触ったときにここが落ちるようにする
const ITEM_1128 = [
  '/kənˈsaɪs/ 簡潔な、要領を得た His answer was concise and clear.',
  '/dɪˈlɪbərət/ 意図的な、慎重な It was a deliberate decision, not an accident.',
  '/ˈtiːdiəs/ 退屈な、うんざりする Filling in the forms was tedious work.',
  '/rɪˈzɪliənt/ 回復力のある、しなやかな Children are surprisingly resilient.',
  '/æmˈbɪɡjuəs/ あいまいな、多義的な The wording of the contract is ambiguous.',
  '/rɪˈdʌndənt/ 冗長な、余分な Remove the redundant code.',
  '/ˈsʌtl/ 微妙な、繊細な There is a subtle difference between the two.',
  '/ˈplɔːzəbl/ もっともらしい、ありそうな That sounds plausible, but I need proof.',
  '/ˈmɪtɪɡeɪt/ 和らげる、軽減する We took steps to mitigate the risk.',
  '/ˈɑːrbətreri/ 恣意的な、任意の The deadline felt arbitrary.',
] as const

describe('parseVocabAnswer', () => {
  test('発音記号・訳・例文の 3 つに分ける', () => {
    // Arrange
    const text = ITEM_1128[0]

    // Act
    const parsed = parseVocabAnswer(text)

    // Assert
    expect(parsed).toEqual({
      ipa: '/kənˈsaɪs/',
      head: '/kənˈsaɪs/ 簡潔な、要領を得た ',
      example: 'His answer was concise and clear.',
    })
  })

  test('#1128 の 10 語すべてで例文を切り出せる', () => {
    // Arrange / Act
    const examples = ITEM_1128.map((text) => parseVocabAnswer(text)?.example)

    // Assert
    expect(examples).toEqual([
      'His answer was concise and clear.',
      'It was a deliberate decision, not an accident.',
      'Filling in the forms was tedious work.',
      'Children are surprisingly resilient.',
      'The wording of the contract is ambiguous.',
      'Remove the redundant code.',
      'There is a subtle difference between the two.',
      'That sounds plausible, but I need proof.',
      'We took steps to mitigate the risk.',
      'The deadline felt arbitrary.',
    ])
  })

  test('分けた文字をつなぐと元の答えに戻る (本文を落とさない)', () => {
    for (const text of ITEM_1128) {
      // Arrange / Act
      const parsed = parseVocabAnswer(text)

      // Assert
      expect(`${parsed?.head ?? ''}${parsed?.example ?? ''}`).toBe(text)
    }
  })

  test('発音記号で始まらない答えは単語帳と見なさない', () => {
    // Arrange / Act / Assert — 電験ノートなどの `||答え||` は素のまま出す
    expect(parseVocabAnswer('オームの法則 V = IR')).toBeNull()
    expect(parseVocabAnswer('簡潔な His answer was concise.')).toBeNull()
  })

  test('例文が無ければ example は null (訳だけの語)', () => {
    // Arrange / Act
    const parsed = parseVocabAnswer('/ˈsʌtl/ 微妙な、繊細な')

    // Assert
    expect(parsed).toEqual({
      ipa: '/ˈsʌtl/',
      head: '/ˈsʌtl/ 微妙な、繊細な',
      example: null,
    })
  })

  test('訳の中の英語 1 語は例文と見なさない', () => {
    // Arrange / Act
    const parsed = parseVocabAnswer('/ˌriːəˈsembl/ 再組み立てする reassemble.')

    // Assert
    expect(parsed?.example).toBeNull()
  })

  test('訳に混ざった英語の途中から例文を始めない', () => {
    // Arrange — 訳に括弧付きで綴りを添える書き方
    const text = '/rɪˈzjuːm/ 再開する(resume) He will resume work tomorrow.'

    // Act
    const parsed = parseVocabAnswer(text)

    // Assert — `(` を画面に取り残さず、`)` も読み上げない
    expect(parsed?.head).toBe('/rɪˈzjuːm/ 再開する(resume) ')
    expect(parsed?.example).toBe('He will resume work tomorrow.')
  })

  test('和文の句点で終わる答えは例文と見なさない', () => {
    // Arrange / Act
    const parsed = parseVocabAnswer('/ˈsʌtl/ 微妙な。とても繊細な。')

    // Assert
    expect(parsed?.example).toBeNull()
  })

  test('例文の後ろの空白は example 側に残す (つなぐと元に戻る)', () => {
    // Arrange
    const text = '/ˈsʌtl/ 微妙な Subtle is hard. '

    // Act
    const parsed = parseVocabAnswer(text)

    // Assert
    expect(parsed?.example).toBe('Subtle is hard. ')
    expect(`${parsed?.head}${parsed?.example}`).toBe(text)
  })
})

describe('trailingHeadword', () => {
  test('答えの直前にある英単語を見出し語として取る', () => {
    // Arrange / Act / Assert — チェックボックスと 🔊 リンクを挟んだ実際の並び
    expect(trailingHeadword(' concise  ')).toBe('concise')
  })

  test('句動詞のような複数語も取る', () => {
    // Arrange / Act / Assert
    expect(trailingHeadword(' give up ')).toBe('give up')
    expect(trailingHeadword(' look forward to ')).toBe('look forward to')
  })

  test('和文が混ざっていれば末尾の英語だけ取る', () => {
    // Arrange / Act / Assert
    expect(trailingHeadword('覚える remember ')).toBe('remember')
  })

  test('長すぎる並びは末尾の 4 語までにする', () => {
    // Arrange / Act
    const word = trailingHeadword('the quick brown fox jumps over ')

    // Assert
    expect(word).toBe('brown fox jumps over')
  })

  test('アポストロフィとハイフンは語の一部として残す', () => {
    // Arrange / Act / Assert
    expect(trailingHeadword('well-known ')).toBe('well-known')
    expect(trailingHeadword("can't ")).toBe("can't")
  })

  test('英語が無ければ null (ボタンを出さない)', () => {
    // Arrange / Act / Assert
    expect(trailingHeadword('オームの法則 ')).toBeNull()
    expect(trailingHeadword('  ')).toBeNull()
    expect(trailingHeadword('')).toBeNull()
  })
})
