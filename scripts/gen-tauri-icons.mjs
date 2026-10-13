#!/usr/bin/env node
/**
 * 生成 Tauri 的占位图标。
 *
 * **为什么要有这个脚本**：Tauri 在编译期就要图标（`bundle.icon` 里那几个文件，
 * 缺失会直接构建失败）。这一步刻意不去做美术资源——第一段只求「能编译、能起」，
 * 图标是以后的事。所以这里是纯色方块 + 一条对角线的 PNG/ICO/ICNS 生成器，
 * 由**Node 内置模块**手写 PNG/ICO，不引任何图像库。
 *
 * 用法：node scripts/gen-tauri-icons.mjs（已存在就跳过，--force 覆盖）
 */
import { deflateSync } from 'node:zlib'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = path.join(repoRoot, 'src-tauri', 'icons')

/** 占位图的主色：和界面主色无关，只是「一眼看出这是占位」。 */
const ACCENT = [0x2f, 0x6f, 0x4f]
const ACCENT_2 = [0x8f, 0xb8, 0x9f]

/** 生成一张 RGBA 像素图：底色 + 一条对角带。 */
function pixels(size) {
  const out = Buffer.alloc(size * size * 4)
  const band = Math.max(1, Math.round(size / 8))
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 四角留空（alpha=0），看起来像个「窗口」而不是纯色块
      const inset = Math.round(size / 16)
      const inside = x >= inset && y >= inset && x < size - inset && y < size - inset
      const onBand = inside && Math.abs(x - y) < band
      const [r, g, b] = onBand ? ACCENT_2 : ACCENT
      const i = (y * size + x) * 4
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      out[i + 3] = inside ? 255 : 0
    }
  }
  return out
}

/** PNG 的 chunk：长度 + 类型 + 数据 + CRC32。 */
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = -1
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** 手写 PNG：8 位 RGBA、无 filter 交错。 */
function png(size) {
  const raw = pixels(size)
  // 每条扫描线前面加一个 filter 字节（0 = None）
  const stride = size * 4
  const filtered = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    filtered[y * (stride + 1)] = 0
    raw.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // 颜色类型：RGBA
  ihdr[10] = 0 // 压缩
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // 非交错

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 手写 ICO：ICONDIR + ICONDIRENTRY + 内嵌 PNG（Windows 从 Vista 起认 PNG 条目）。 */
function ico(size) {
  const image = png(size)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // 只有一张

  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size // 256 在 ICO 里写 0
  entry[1] = size >= 256 ? 0 : size
  entry[2] = 0 // 调色板数
  entry[3] = 0 // reserved
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bpp
  entry.writeUInt32LE(image.length, 8)
  entry.writeUInt32LE(6 + 16, 12) // 数据偏移

  return Buffer.concat([header, entry, image])
}

/**
 * ICNS：容器格式，每个条目 = 4 字节类型 + 4 字节长度 + 数据。
 * 用 `ic07`（128x128 PNG）与 `ic08`（256x256 PNG）就够 Tauri 打包用了。
 */
function icns() {
  const items = [
    ['ic07', png(128)],
    ['ic08', png(256)],
  ]
  const parts = items.map(([type, data]) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

const force = process.argv.includes('--force')
mkdirSync(iconsDir, { recursive: true })

// 文件名与 tauri.conf.json 的 bundle.icon 一一对应，不要在这里自创命名
const files = {
  '32x32.png': png(32),
  '128x128.png': png(128),
  '128x128@2x.png': png(256),
  'icon.png': png(512),
  'icon.ico': ico(256),
  'icon.icns': icns(),
}

let written = 0
for (const [name, data] of Object.entries(files)) {
  const target = path.join(iconsDir, name)
  if (!force && existsSync(target)) continue
  writeFileSync(target, data)
  written += 1
  console.log(`生成 src-tauri/icons/${name}（${data.length} 字节）`)
}
console.log(written === 0 ? '图标已存在，跳过（--force 可覆盖）' : `共生成 ${written} 个占位图标`)
