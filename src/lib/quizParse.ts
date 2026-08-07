// ```quiz フェンスの中身を「問・選択肢・正解・解説」に割る純関数
// (docs/58-CBT問題集計画.md §2)。DOM も remark も要らないので葉モジュール。
//
// 行頭キーワードの行指向にしているのは、iPhone で手打ちするから
// (YAML や JSON は括弧とインデントの管理が要り、書き味が落ちる)。
// 中身は解釈せずそのままの文字で返す — markdown として描くのは呼び手の仕事。

import { splitLines } from './memoLines'

export interface Quiz {
  question: string
  // 選択肢の中身 (番号は含まない)。添字 0 が選択肢 1
  choices: string[]
  // 正解の番号 (1 始まり)。choices の添字ではないことに注意
  answer: number
  // 省略可 (単語帳のような軽い出題では解説が要らない)
  explanation: string | null
}

export type QuizParseResult = Quiz | { error: string }

// 五肢択一 (電験・情報処理など) が主用途だが、4 択の試験もあるので幅を持たせる。
// 上限 9 は選択肢の番号を 1 桁に限っていることから来る (下の CHOICE_RE)
const MIN_CHOICES = 2
const MAX_CHOICES = 9

// キーワードは全角コロンも許す。日本語入力では「：」が出やすく、
// 半角に直させるだけの門番にはしない
const QUESTION_RE = /^問\s*[:：]\s*(.*)$/
const ANSWER_RE = /^正解\s*[:：]\s*(.*)$/
const EXPLANATION_RE = /^解説\s*[:：]\s*(.*)$/

// 数字は全角も許す。日本語入力では「１」が出やすく、半角に直させるだけの
// 門番にはしない (全角コロンを許すのと同じ理由)
const DIGIT = '[0-9０-９]'

// 選択肢の行。番号は 1 桁 (1〜9) で、句点は半角と全角の両方を許す。
// 字下げを 3 つまで許すのは markdown のフェンス・リストの作法に合わせるため。
//
// **この行は「次に来るはずの番号」と一致したときだけ選択肢として扱う**
// (下の parseQuiz を参照)。問題文の中に番号付きリストを書いても、
// 番号が続かなければただの本文として読まれる
const CHOICE_RE = new RegExp(`^ {0,3}(${DIGIT})\\s*[.．]\\s*(.*)$`)

// 「番号付きの行に見えるが、次に来るはずの番号ではない」ものを見つける網。
// 選択肢を並べている途中でこれに当たったら、番号の振り間違い (4 を 5 と打った、
// 順番が入れ替わった、10 個目を書いた) として**エラーにする** — 黙って直前の
// 選択肢の続きとして吸い込むと、選択肢が 1 つ減ったまま「解ける問題」として
// 描かれてしまい、書いた本人が気付けない
const NUMBERED_LINE_RE = new RegExp(`^ {0,3}${DIGIT}{1,2}\\s*[.．]`)

// 正解の値。「(2)」「2番」のような書き方も読むが、**それ以外の文字が残るなら
// エラー**にする。先頭の数字だけ拾って残りを捨てると、「正解: 1と3」と
// 書いた人に黙って片方だけの問題を出してしまう
const ANSWER_VALUE_RE = new RegExp(
  `^[(（]?\\s*(${DIGIT}+)\\s*[)）]?\\s*(?:番目?)?$`,
)

// 全角数字を半角に直してから Number に渡す
function toHalfWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  )
}

function numberOf(text: string): number {
  return Number(toHalfWidthDigits(text))
}

// 溜めた行を 1 つの文字列にする。前後の空行は落とすが、途中の空行は
// 段落の区切りとして残す (解説を複数段落で書けるように)
function joinBlock(lines: string[]): string {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') {
    start++
  }
  while (end > start && lines[end - 1].trim() === '') {
    end--
  }
  return lines.slice(start, end).join('\n')
}

export function parseQuiz(source: string): QuizParseResult {
  const question: string[] = []
  const choices: string[][] = []
  const explanation: string[] = []
  let answerText: string | null = null
  let hasExplanation = false
  // いま行を溜めている先。null なら「問:」がまだ来ていない
  let sink: string[] | null = null
  // 溜め先が選択肢そのものか (行が選択肢の続きになる状態か)。
  // 番号の振り間違いを叱るのは、この状態のときだけにする — 問題文の中の
  // 番号付きリストまで叱ると、ふつうの markdown が書けなくなる
  let inChoice = false

  for (const line of splitLines(source)) {
    const questionMatch = QUESTION_RE.exec(line)
    if (questionMatch) {
      if (question.length > 0) {
        return { error: '「問:」が 2 つあります。1 つのフェンスに 1 問です' }
      }
      if (sink !== null) {
        return { error: '「問:」はいちばん先に書いてください' }
      }
      question.push(questionMatch[1])
      sink = question
      continue
    }

    // 番号が「次に来るはずのもの」と一致するときだけ選択肢の始まりと見る。
    // 問題文中の番号付きリストを選択肢と読み違えないための歯止め
    const choiceMatch = CHOICE_RE.exec(line)
    if (
      sink !== null &&
      choiceMatch &&
      numberOf(choiceMatch[1]) === choices.length + 1
    ) {
      if (answerText !== null || hasExplanation) {
        return { error: '選択肢は「正解:」より前に並べてください' }
      }
      const choice = [choiceMatch[2]]
      choices.push(choice)
      sink = choice
      inChoice = true
      continue
    }

    // 選択肢を並べている途中の「番号付きに見えるが番号が合わない行」。
    // 黙って直前の選択肢に吸い込むと選択肢が 1 つ消えたまま成立してしまう
    if (inChoice && NUMBERED_LINE_RE.test(line)) {
      return {
        error:
          choices.length >= MAX_CHOICES
            ? `選択肢は ${MAX_CHOICES} つまでです`
            : `選択肢の番号は 1 から順に振ってください (${choices.length + 1} が来るはずのところに「${line.trim()}」)`,
      }
    }

    const answerMatch = ANSWER_RE.exec(line)
    if (answerMatch) {
      if (answerText !== null) {
        return { error: '「正解:」が 2 つあります' }
      }
      answerText = answerMatch[1].trim()
      // 正解は 1 行で完結する。以降の行は解説か、書き間違いのどちらか
      sink = null
      inChoice = false
      continue
    }

    const explanationMatch = EXPLANATION_RE.exec(line)
    if (explanationMatch) {
      if (hasExplanation) {
        return { error: '「解説:」が 2 つあります' }
      }
      hasExplanation = true
      explanation.push(explanationMatch[1])
      sink = explanation
      inChoice = false
      continue
    }

    if (line.trim() === '') {
      // 空行は溜め先があるときだけ意味を持つ (段落の区切り)
      sink?.push(line)
      continue
    }
    if (sink === null) {
      return {
        error:
          question.length === 0
            ? '「問:」で始めてください'
            : `「正解:」の後は「解説:」だけです (${line.trim()})`,
      }
    }
    sink.push(line)
  }

  return buildQuiz(question, choices, answerText, hasExplanation ? explanation : null)
}

function buildQuiz(
  questionLines: string[],
  choiceLines: string[][],
  answerText: string | null,
  explanationLines: string[] | null,
): QuizParseResult {
  if (questionLines.length === 0) {
    return { error: '「問:」がありません' }
  }
  const question = joinBlock(questionLines)
  if (question === '') {
    return { error: '「問:」の中身が空です' }
  }

  const choices = choiceLines.map(joinBlock)
  if (choices.length < MIN_CHOICES) {
    // 「見つからない」原因はたいてい番号の書き方 (全角数字は許すが、
    // `(1)` や `1)` は選択肢と見ない) なので、書き方まで添えて知らせる
    return {
      error: `選択肢が ${MIN_CHOICES} つ以上必要です (見つかったのは ${choices.length} つ)。「1. 選択肢」の形で 1 から順に並べてください`,
    }
  }
  const emptyAt = choices.findIndex((choice) => choice === '')
  if (emptyAt >= 0) {
    return { error: `選択肢 ${emptyAt + 1} の中身が空です` }
  }

  if (answerText === null) {
    return { error: '「正解:」がありません' }
  }
  const answerMatch = ANSWER_VALUE_RE.exec(answerText)
  if (!answerMatch) {
    // 「1と3」のような複数解答もここで弾かれる。先頭の数字だけ拾うと、
    // 書いた人の意図と違う問題が黙って出来上がる
    return {
      error: `「正解:」は選択肢の番号を 1 つだけ書いてください (${answerText})`,
    }
  }
  const answer = numberOf(answerMatch[1])
  if (answer < 1 || answer > choices.length) {
    return {
      error: `「正解: ${answer}」に当たる選択肢がありません (選択肢は ${choices.length} つ)`,
    }
  }

  const explanation = explanationLines === null ? null : joinBlock(explanationLines)
  return {
    question,
    choices,
    answer,
    explanation: explanation === '' ? null : explanation,
  }
}
