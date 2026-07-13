import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { usePublicClient } from 'wagmi'
import { createWalletClient, custom, parseAbi, type WalletClient } from 'viem'
import { avalancheFuji } from 'wagmi/chains'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useSmoothSendWrite } from '@smoothsend/sdk/avax'
import { packPixelUpdate } from './pixelPacking'
import { usePixelSync } from './usePixelSync'
import { BOARD_SIZE, CONTRACT_ADDRESS, PALETTE } from './config'

const contractAbi = parseAbi([
  'function paintPixels(uint40[] packed) external',
  'function getCanvas() external view returns (uint24[4096])',
])

const PIXEL_SIZE = 12
const EMPTY = '#ffffff'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
const MAX_BATCH_SIZE = 256

function makeGrid() {
  return Array<string>(BOARD_SIZE * BOARD_SIZE).fill(EMPTY)
}

function isHexColor(value: string): value is `#${string}` {
  return /^#[0-9a-f]{6}$/i.test(value)
}

function toHexColor(value: bigint | number): `#${string}` {
  const hex = Number(value).toString(16).padStart(6, '0')
  return `#${hex}` as `#${string}`
}

export default function App() {
  const { authenticated, ready, login, logout } = usePrivy()
  const { wallets } = useWallets()
  const publicClient = usePublicClient()
  const activeWalletAddress = wallets[0]?.address as `0x${string}` | undefined
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null)

  const { writeContract, isPending } = useSmoothSendWrite({
    publicClient,
    apiKey: (import.meta as any).env.VITE_SMOOTHSEND_API_KEY as string,
    ownerAddress: activeWalletAddress ?? ZERO_ADDRESS,
    walletClient,
  })

  const [pixels, setPixels] = useState<string[]>(makeGrid)
  const [selectedColor, setSelectedColor] = useState(PALETTE[2])
  const [isEraser, setIsEraser] = useState(false)
  const [status, setStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isDrawing = useRef(false)
  const pendingPixels = useRef<Map<number, bigint>>(new Map())
  const flushPaintQueueRef = useRef<(() => Promise<void>) | null>(null)
  const activeColor = isEraser ? EMPTY : selectedColor

  const applyPixelFromChain = useCallback((x: number, y: number, rgb: string) => {
    if (!isHexColor(rgb)) return
    setPixels(prev => {
      const next = [...prev]
      next[y * BOARD_SIZE + x] = rgb
      return next
    })
  }, [])

  usePixelSync(applyPixelFromChain, true)

  useEffect(() => {
    let cancelled = false

    const loadWalletClient = async () => {
      if (!authenticated || !wallets.length || !activeWalletAddress) {
        setWalletClient(null)
        return
      }

      try {
        const provider = await wallets[0].getEthereumProvider()
        if (cancelled) return

        const client = createWalletClient({
          account: activeWalletAddress,
          chain: avalancheFuji,
          transport: custom(provider),
        })
        setWalletClient(client)
      } catch {
        if (!cancelled) setWalletClient(null)
      }
    }

    void loadWalletClient()

    return () => {
      cancelled = true
    }
  }, [activeWalletAddress, authenticated, wallets])

  useEffect(() => {
    const stopDrawing = () => {
      if (!isDrawing.current) return
      isDrawing.current = false
      void flushPaintQueueRef.current?.()
    }

    window.addEventListener('pointerup', stopDrawing)
    window.addEventListener('pointercancel', stopDrawing)
    window.addEventListener('blur', stopDrawing)
    return () => {
      window.removeEventListener('pointerup', stopDrawing)
      window.removeEventListener('pointercancel', stopDrawing)
      window.removeEventListener('blur', stopDrawing)
    }
  }, [])

  useEffect(() => {
    if (!publicClient) return

    const loadCanvas = async () => {
      try {
        const canvas = await publicClient.readContract({
          abi: contractAbi,
          address: CONTRACT_ADDRESS,
          functionName: 'getCanvas',
        })

        if (!Array.isArray(canvas) || canvas.length !== BOARD_SIZE * BOARD_SIZE) return

        const next = canvas.map((v) => toHexColor(v as bigint | number))
        setPixels(next)
      } catch {
        // Keep default empty grid if contract read fails.
      }
    }

    loadCanvas()
  }, [publicClient])

  const queuePixel = useCallback((index: number, color: string) => {
    if (!authenticated || !activeWalletAddress) return
    const x = index % BOARD_SIZE
    const y = Math.floor(index / BOARD_SIZE)
    const packed = packPixelUpdate(x, y, color)
    pendingPixels.current.set(index, packed)
    setPixels(prev => {
      const next = [...prev]
      next[index] = color
      return next
    })
  }, [activeWalletAddress, authenticated])

  const flushPaintQueue = useCallback(async () => {
    if (!authenticated || !activeWalletAddress) return
    if (isPending || submitting) return
    if (pendingPixels.current.size === 0) return

    const batchEntries = [...pendingPixels.current.entries()]
    pendingPixels.current.clear()

    setSubmitting(true)
    setStatus(`Painting ${batchEntries.length} pixel${batchEntries.length === 1 ? '' : 's'}...`)

    try {
      const packedBatch = batchEntries.map(([, packed]) => packed)
      for (let i = 0; i < packedBatch.length; i += MAX_BATCH_SIZE) {
        const chunk = packedBatch.slice(i, i + MAX_BATCH_SIZE)
        await writeContract({
          abi: contractAbi,
          address: CONTRACT_ADDRESS,
          functionName: 'paintPixels',
          args: [chunk],
          mode: 'developer-sponsored',
        })
      }
      setStatus(`Placed ${batchEntries.length} pixel${batchEntries.length === 1 ? '' : 's'}.`)
      setTimeout(() => setStatus(''), 1800)
    } catch (e: unknown) {
      for (const [index, packed] of batchEntries) {
        pendingPixels.current.set(index, packed)
      }
      const err = e as { shortMessage?: string; message?: string }
      setStatus(`Error: ${err?.shortMessage || err?.message || 'Unknown error'}`)
    } finally {
      setSubmitting(false)
    }
  }, [activeWalletAddress, authenticated, isPending, submitting, writeContract])

  useEffect(() => {
    flushPaintQueueRef.current = flushPaintQueue
  }, [flushPaintQueue])

  const handlePointerDown = (index: number) => {
    if (!authenticated || !ready || isPending || submitting) return
    isDrawing.current = true
    queuePixel(index, activeColor)
  }

  const handlePointerEnter = (index: number) => {
    if (!isDrawing.current) return
    queuePixel(index, activeColor)
  }

  const shortAddr = activeWalletAddress ? `${activeWalletAddress.slice(0, 6)}...${activeWalletAddress.slice(-4)}` : null
  const busy = isPending || submitting || !ready
  const statusClass = status.startsWith('Error:') ? 'status error' : 'status ok'
  const canDraw = authenticated && !busy

  const stats = useMemo(() => {
    let painted = 0
    for (const value of pixels) {
      if (value !== EMPTY) painted += 1
    }
    return {
      painted,
      total: BOARD_SIZE * BOARD_SIZE,
      percent: Math.round((painted / (BOARD_SIZE * BOARD_SIZE)) * 100),
    }
  }, [pixels])

  return (
    <div className="page-shell">
      <div className="gradient-glow gradient-left" aria-hidden />
      <div className="gradient-glow gradient-right" aria-hidden />

      <main className="layout">
        <section className="hero">
          <div className="hero-top">
            <div>
              <p className="eyebrow">SmoothSend Demo</p>
              <h1>r/place on Fuji, fully gasless</h1>
              <p className="subhead">
                Paint a shared 64x64 canvas where every click is sponsored and anyone can participate.
              </p>
            </div>

            <div className="auth-block">
              {shortAddr && <span className="wallet-pill">{shortAddr}</span>}
              {authenticated ? (
                <button className="btn ghost" onClick={() => logout()}>Disconnect</button>
              ) : (
                <button
                  className="btn primary"
                  onClick={() => login()}
                >
                  Sign in
                </button>
              )}
            </div>
          </div>

          <div className="meta-row">
            <div className="meta-card">
              <span>Board</span>
              <strong>{BOARD_SIZE}x{BOARD_SIZE}</strong>
            </div>
            <div className="meta-card">
              <span>Filled</span>
              <strong>{stats.painted}/{stats.total}</strong>
            </div>
            <div className="meta-card">
              <span>Coverage</span>
              <strong>{stats.percent}%</strong>
            </div>
          </div>

          {status && <div className={statusClass}>{status}</div>}

          {!authenticated && (
            <div className="notice">
              Sign in to paint. Privy handles wallet auth, and SmoothSend sponsors gas for supported transactions.
            </div>
          )}
        </section>

        <section className="studio">
          <div className="toolbar">
            <div className="palette" role="list" aria-label="Color palette">
              {PALETTE.map(color => {
                const selected = !isEraser && selectedColor === color
                return (
                  <button
                    key={color}
                    role="listitem"
                    onClick={() => { setSelectedColor(color); setIsEraser(false) }}
                    className={selected ? 'swatch selected' : 'swatch'}
                    style={{ backgroundColor: color }}
                    title={color}
                    aria-label={`Select ${color}`}
                  />
                )
              })}
            </div>

            <div className="toolbar-actions">
              <button
                className={isEraser ? 'btn primary' : 'btn ghost'}
                onClick={() => setIsEraser(v => !v)}
              >
                Eraser
              </button>
              {busy && <span className="busy">Submitting...</span>}
            </div>
          </div>

          <div className="board-wrap">
            <div
              className={canDraw ? 'board interactive' : 'board disabled'}
              style={{
                gridTemplateColumns: `repeat(${BOARD_SIZE}, ${PIXEL_SIZE}px)`,
                gridTemplateRows: `repeat(${BOARD_SIZE}, ${PIXEL_SIZE}px)`,
                pointerEvents: canDraw ? 'auto' : 'none',
              }}
            >
              {pixels.map((color, i) => (
                <div
                  key={i}
                  className="cell"
                  style={{ background: color }}
                  onPointerDown={() => handlePointerDown(i)}
                  onPointerEnter={() => handlePointerEnter(i)}
                />
              ))}
            </div>
          </div>

          <p className="footnote">
            Live sync via on-chain PixelPainted events every 5 seconds.
          </p>
        </section>
      </main>
    </div>
  )
}
