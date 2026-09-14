// ログインのパスワードから .env に貼る BASIC_AUTH_HASH_B64 を作る
// (docs/18-ログイン計画.md)。
//
//   npm run hash-password
//
// なぜスクリプトにするか:
//
//  1. シェルのクォート事故を防ぐ。`caddy hash-password --plaintext '<パスワード>'`
//     に貼る方式だと、パスワードに $ や ! や ' が入っていた場合、シェルが
//     別の文字列に変えてしまう。できるのは「自分が思っているのとは違う
//     パスワードのハッシュ」で、しかもログインするまで気づけない。
//     ここでは端末から直接読むのでシェルを通さない
//  2. コストを固定する。caddy hash-password はコスト 14 で、vps2 では
//     1 回の照合に 7 秒かかった (実測)。ここは 12 (vps2 で約 1.75 秒)
//  3. base64 まで一息でやる。生の bcrypt ハッシュ ($2b$12$…) を .env に
//     書くと Next.js の env 展開が $ を変数として食って値が壊れる
//     (src/lib/auth/basicAuth.ts のコメント参照)
//
// 照合に使うのと同じ bcryptjs で作るので、生成側と検証側がずれない。

import bcrypt from 'bcryptjs'
import readline from 'node:readline'
import { stdin, stdout } from 'node:process'

// bcrypt のコストは 1 増えるごとに所要時間が倍になる (実測でもちょうど 2.0 倍)。
// vps2 は非力で、cost 14 = 7.0 秒 / cost 12 = 約 1.75 秒。
// 12 より下げると総当たりに対して弱くなるので、これ以上は下げない
const COST = 12

function askPassword(query) {
  // パイプで渡されたとき (echo pw | npm run hash-password) も動くようにする。
  // 端末が無い CI などで prompt を待って固まらないため
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let data = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (chunk) => (data += chunk))
      stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')))
    })
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true })
    let muted = false
    // 入力した文字を画面に出さない。肩越しに見られる / 端末のログに残るのを防ぐ
    rl._writeToOutput = (text) => {
      if (!muted) {
        rl.output.write(text)
      }
    }
    rl.question(query, (answer) => {
      rl.close()
      stdout.write('\n')
      resolve(answer)
    })
    muted = true
  })
}

const password = await askPassword('パスワード: ')

// 空パスワードは auth/basicAuth.ts が必ず弾く。ここで作れてしまうと
// 「設定したのに入れない」で悩むことになるので、作らせない
if (password.length === 0) {
  console.error('パスワードが空です。中止しました。')
  process.exit(1)
}

const hash = await bcrypt.hash(password, COST)
const b64 = Buffer.from(hash, 'utf8').toString('base64')

console.log()
console.log(`.env の BASIC_AUTH_HASH_B64 をこの行に置き換える (cost ${COST}):`)
console.log()
console.log(`BASIC_AUTH_HASH_B64=${b64}`)
console.log()
console.log('vps2 にも同じ値を入れる手順は docs/18-ログイン計画.md を参照。')
