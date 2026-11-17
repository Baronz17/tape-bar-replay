// Generates the PWA PNG icons with no dependencies (raw PNG encoder).
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}

function icon(size) {
  const px = Buffer.alloc(size * size * 3)
  const fill = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++)
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        const i = (y * size + x) * 3
        px[i] = r; px[i + 1] = g; px[i + 2] = b
      }
  }
  fill(0, 0, size, size, [13, 16, 20])
  const u = size / 64
  const candle = (cx, wt, wb, bt, bb, col) => {
    fill((cx - 1) * u, wt * u, (cx + 1) * u, wb * u, col)
    fill((cx - 5) * u, bt * u, (cx + 5) * u, bb * u, col)
  }
  candle(19, 18, 46, 23, 38, [229, 72, 77])
  candle(32, 14, 46, 19, 40, [47, 191, 138])
  candle(45, 21, 50, 26, 43, [232, 162, 58])
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}
writeFileSync('public/icon-192.png', icon(192))
writeFileSync('public/icon-512.png', icon(512))
writeFileSync('public/apple-touch-icon.png', icon(180))
console.log('icons written')
