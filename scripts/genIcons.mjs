// PWA アイコンとブラウザタブのアイコンを SVG から生成する。
//
// copyTikzFonts.mjs と違い、これは **ビルドでは走らない**。生成物 (public/icon-*.png と
// src/app/apple-icon.png, src/app/icon.svg) はリポジトリにコミットしてある。
// 意匠を変えたいときだけ手で叩く:
//
//   node scripts/genIcons.mjs
//
// 絵柄は QR のファインダパターン 3 個 + 虫めがね。虫めがねは旧名「QR search」の
// 名残だが、貼った QR から探して開くという中身は変わっていないので意匠は据え置く。
// 元絵を SVG でここに直書きしているのは、512px の PNG を唯一の原本にすると
// 修正のたびに手作業のトレースが要るため (PNG は原本ではなく生成物)。
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SIZE = 512 // 元絵の viewBox。出力サイズはここから縮小する
const PAD = 64 // 縁の余白 (content は 384x384)
const FG = '#ffffff'
const BG = '#2563eb' // tailwind blue-600 = アプリのアクセント色。白の FG と 4.6:1 で分離する
const FINDER = 120 // ファインダパターン 1 個の一辺
const M = FINDER / 7 // QR のモジュール 1 個 (ファインダは 7x7 モジュール)

// QR のファインダパターン: 外枠 (7x7) → 余白 (5x5) → 中心 (3x3) の入れ子
const finder = (x, y) => `
    <rect x="${x}" y="${y}" width="${FINDER}" height="${FINDER}" rx="${M * 0.7}" fill="${FG}"/>
    <rect x="${x + M}" y="${y + M}" width="${M * 5}" height="${M * 5}" rx="${M * 0.4}" fill="${BG}"/>
    <rect x="${x + 2 * M}" y="${y + 2 * M}" width="${M * 3}" height="${M * 3}" rx="${M * 0.3}" fill="${FG}"/>`

const RIGHT = SIZE - PAD - FINDER // 右列・下列のファインダ座標

// 虫めがね。ファインダが埋めない右下の空きに置く
const LENS_CX = 380
const LENS_CY = 380
const LENS_R = 50
const HANDLE_START = 38 // 中心からの距離。円周 (r=50) より内側から描いて繋ぎ目を隠す
const HANDLE_END = 442 // 他のファインダの外縁 (PAD+FINDER=184 の対角) と釣り合う位置

const content = `
    ${finder(PAD, PAD)}
    ${finder(RIGHT, PAD)}
    ${finder(PAD, RIGHT)}
    <circle cx="${LENS_CX}" cy="${LENS_CY}" r="${LENS_R}" fill="none" stroke="${FG}" stroke-width="22"/>
    <line x1="${LENS_CX + HANDLE_START}" y1="${LENS_CY + HANDLE_START}" x2="${HANDLE_END}" y2="${HANDLE_END}"
          stroke="${FG}" stroke-width="26" stroke-linecap="round"/>`

// maskable はランチャーが任意の形に切り抜くため、中央 80% の円 (r=204.8) に
// 収まる分しか安全でない。content の外接円は r≈271 あるので 0.75 に縮める
const MASKABLE_SCALE = 0.75

/**
 * @param {{ radius: number, scale?: number }} opts
 *   radius … 背景角丸。maskable / apple-icon はランチャー側が丸めるので 0 (全面塗り)
 */
const svg = ({ radius, scale = 1 }) => `<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
    <rect width="${SIZE}" height="${SIZE}" rx="${radius}" fill="${BG}"/>
    <g transform="translate(${SIZE / 2} ${SIZE / 2}) scale(${scale}) translate(${-SIZE / 2} ${-SIZE / 2})">
    ${content}
    </g>
</svg>`

// flatten … 透過を捨てて不透明にする。全面塗りの 2 つはどのみち全画素不透明だが、
// iOS は apple-touch-icon の透過部を黒く潰す仕様なので alpha は持たせない。
// 逆に角丸の 2 つは四隅の透過が要るので残す
const targets = [
  { file: 'public/icon-192.png', size: 192, svg: svg({ radius: 96 }) },
  { file: 'public/icon-512.png', size: 512, svg: svg({ radius: 96 }) },
  {
    file: 'public/icon-512-maskable.png',
    size: 512,
    svg: svg({ radius: 0, scale: MASKABLE_SCALE }),
    flatten: true,
  },
  { file: 'src/app/apple-icon.png', size: 180, svg: svg({ radius: 0 }), flatten: true },
]

for (const target of targets) {
  const out = path.join(projectRoot, target.file)
  const image = sharp(Buffer.from(target.svg)).resize(target.size, target.size)
  await (target.flatten ? image.flatten({ background: BG }) : image)
    .png({ compressionLevel: 9 })
    .toFile(out)
  console.log(`icon: ${target.file} (${target.size}x${target.size})`)
}

// ブラウザタブのアイコン。Next.js の icon.(svg|png|ico) 規約で <link rel="icon"> が付く。
// ここだけ PNG に焼かず SVG のまま置くのは、favicon が 16px から数百 px まで
// 環境ごとに違うサイズで描かれるため。ベクタなら全サイズで鮮明になる (sizes="any")。
const svgIcon = 'src/app/icon.svg'
await writeFile(path.join(projectRoot, svgIcon), `${svg({ radius: 96 })}\n`)
console.log(`icon: ${svgIcon} (vector)`)
