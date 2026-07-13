import { useEffect, useRef, useCallback } from 'react'
import { createPublicClient, http, parseAbiItem } from 'viem'
import { CHAIN, CONTRACT_ADDRESS, BOARD_SIZE, POLL_INTERVAL_MS } from './config'

const PIXEL_PAINTED_ABI = parseAbiItem(
  'event PixelPainted(uint8 indexed x, uint8 indexed y, uint24 rgb, address indexed painter)'
)

const client = createPublicClient({
  chain: CHAIN,
  transport: http(),
})

type ApplyPixel = (x: number, y: number, rgb: string) => void

export function usePixelSync(applyPixel: ApplyPixel, enabled: boolean) {
  const lastBlockRef = useRef<bigint | null>(null)
  const applyRef = useRef(applyPixel)
  applyRef.current = applyPixel

  const poll = useCallback(async () => {
    try {
      const latest = await client.getBlockNumber()

      // On first poll, go back ~50 blocks to load recent history
      const from = lastBlockRef.current
        ? lastBlockRef.current + 1n
        : latest - 50n < 0n ? 0n : latest - 50n

      if (from > latest) return
      lastBlockRef.current = latest

      const logs = await client.getLogs({
        address: CONTRACT_ADDRESS,
        event: PIXEL_PAINTED_ABI,
        fromBlock: from,
        toBlock: latest,
      })

      for (const log of logs) {
        const { x, y } = log.args
        const rgb = log.args.rgb
        if (x === undefined || y === undefined || rgb === undefined) continue

        const px = Number(x)
        const py = Number(y)
        const hex = `#${Number(rgb).toString(16).padStart(6, '0')}`

        if (px < BOARD_SIZE && py < BOARD_SIZE) {
          applyRef.current(px, py, hex)
        }
      }
    } catch {
      // silently ignore poll errors
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [enabled, poll])
}
