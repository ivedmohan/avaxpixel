export function packPixelUpdate(x: number, y: number, rgbHex: string): bigint {
  const normalized = rgbHex.startsWith('#') ? rgbHex.slice(1) : rgbHex
  const rgb = BigInt(`0x${normalized}`)
  return (BigInt(x) << 32n) | (BigInt(y) << 24n) | rgb
}

export function unpackPixelUpdate(packed: bigint): { x: number; y: number; rgb: string } {
  const x = Number((packed >> 32n) & 0xffn)
  const y = Number((packed >> 24n) & 0xffn)
  const rgb = Number(packed & 0xffffffn)
  return { x, y, rgb: `#${rgb.toString(16).padStart(6, '0')}` }
}
