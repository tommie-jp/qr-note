// Docker の依存レイヤー専用に、版番号を潰した package.json / package-lock.json の
// 写しを .deps/ へ書き出す (docs/80-デプロイ再高速化計画.md §S1)。
//
// なぜ要るか:
//   doDeploy.sh はビルドの**前**に doVersion.sh で版を上げる。Dockerfile が
//   素の package.json を依存レイヤーへ COPY していると、版が 1 つ上がるだけで
//   その層のダイジェストが変わり、**依存が 1 つも変わっていないのに npm ci が
//   毎デプロイ走り直す** (実測 20.7 秒)。
//
//   そこで依存レイヤーには「版だけを 0.0.0 に固めた写し」を配る。依存が変わら
//   ない限りバイト単位で同じなので、npm ci の層はキャッシュに載ったままになる。
//   実体の package.json は後続の `COPY . .` が上書きするので、イメージに入る
//   中身も、next build がフッターへ焼き込む版も従来どおり。
//
// package-lock.json は版を 2 箇所 (ルートと packages[""]) に持つ。**両方**を
// 潰さないと npm ci が「package.json と package-lock.json が同期していない」と
// 言って落ちる。
//
// 出力を JSON.stringify で作り直しているのは、入力が同じなら出力も同じになる
// ため。ここが不安定だと層のダイジェストが揺れて目的を果たさない。
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destDir = path.join(projectRoot, '.deps')

const PLACEHOLDER_VERSION = '0.0.0'
const FILES = ['package.json', 'package-lock.json']

async function normalize(fileName) {
  const source = path.join(projectRoot, fileName)
  const raw = await readFile(source, 'utf8')

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${fileName} を JSON として読めない: ${error.message}`)
  }

  parsed.version = PLACEHOLDER_VERSION
  // package-lock.json はルート以外に packages[""] にも版を持つ
  if (parsed.packages?.['']) {
    parsed.packages[''].version = PLACEHOLDER_VERSION
  }

  await writeFile(path.join(destDir, fileName), `${JSON.stringify(parsed, null, 2)}\n`)
}

await mkdir(destDir, { recursive: true })
await Promise.all(FILES.map(normalize))
console.log(`.deps/ を更新した (${FILES.join(', ')} の版を ${PLACEHOLDER_VERSION} に固定)`)
