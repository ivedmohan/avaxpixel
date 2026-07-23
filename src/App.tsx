import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { usePublicClient } from 'wagmi'
import { createWalletClient, custom, isHex, parseAbi, toHex } from 'viem'
import { avalanche } from 'wagmi/chains'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useSmoothSendPrivyWrite } from '@smoothsend/sdk/avax'
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
const MAX_BATCH_SIZE = 50
const FLUSH_IDLE_MS = 700
const FLUSH_TRIGGER_SIZE = 50

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

  const signMessage = useCallback(async ({ message }: { message: string }) => {
    if (!wallets.length || !activeWalletAddress) {
      throw new Error('Wallet not ready')
    }

    const rawMessage = (isHex(message) ? message : toHex(message)) as `0x${string}`
    const provider = await wallets[0].getEthereumProvider()
    const walletClient = createWalletClient({
      account: activeWalletAddress,
      chain: avalanche,
      transport: custom(provider),
    })

    return walletClient.signMessage({
      account: activeWalletAddress,
      message: { raw: rawMessage },
    })
  }, [activeWalletAddress, wallets])

  const { writeContract, isPending } = useSmoothSendPrivyWrite({
    publicClient,
    apiKey: (import.meta as any).env.VITE_SMOOTHSEND_API_KEY as string,
    ownerAddress: activeWalletAddress ?? ZERO_ADDRESS,
    signMessage,
  })

  const [pixels, setPixels] = useState<string[]>(makeGrid)
  const [selectedColor, setSelectedColor] = useState(PALETTE[2])
  const [isEraser, setIsEraser] = useState(false)
  const [status, setStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isDrawing = useRef(false)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const pendingPixels = useRef<Map<number, bigint>>(new Map())
  const optimisticPixels = useRef<Map<number, string>>(new Map())
  const flushPaintQueueRef = useRef<(() => Promise<void>) | null>(null)
  const flushTimerRef = useRef<number | null>(null)
  const submittingRef = useRef(false)
  const activeColor = isEraser ? EMPTY : selectedColor

  const scheduleFlush = useCallback((delayMs = 0) => {
    if (flushTimerRef.current !== null) return
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      void flushPaintQueueRef.current?.()
    }, delayMs)
  }, [])

  const applyPixelFromChain = useCallback((x: number, y: number, rgb: string) => {
    if (!isHexColor(rgb)) return
    const index = y * BOARD_SIZE + x
    const optimistic = optimisticPixels.current.get(index)
    if (optimistic && optimistic.toLowerCase() !== rgb.toLowerCase()) return
    if (optimistic && optimistic.toLowerCase() === rgb.toLowerCase()) {
      optimisticPixels.current.delete(index)
    }
    setPixels(prev => {
      const next = [...prev]
      next[index] = rgb
      return next
    })
  }, [])

  usePixelSync(applyPixelFromChain, true)

  useEffect(() => {
    const stopDrawing = () => {
      if (!isDrawing.current) return
      isDrawing.current = false
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      void flushPaintQueueRef.current?.()
    }

    window.addEventListener('pointerup', stopDrawing)
    window.addEventListener('pointercancel', stopDrawing)
    window.addEventListener('blur', stopDrawing)
    return () => {
      window.removeEventListener('pointerup', stopDrawing)
      window.removeEventListener('pointercancel', stopDrawing)
      window.removeEventListener('blur', stopDrawing)
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (isPending || submittingRef.current) return
    if (pendingPixels.current.size === 0) return
    scheduleFlush(0)
  }, [isPending, scheduleFlush])

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
    if (index < 0 || index >= BOARD_SIZE * BOARD_SIZE) return
    const x = index % BOARD_SIZE
    const y = Math.floor(index / BOARD_SIZE)
    const packed = packPixelUpdate(x, y, color)
    pendingPixels.current.set(index, packed)
    optimisticPixels.current.set(index, color)
    setPixels(prev => {
      const next = [...prev]
      next[index] = color
      return next
    })

    if (isPending || submittingRef.current) {
      return
    }

    if (pendingPixels.current.size >= FLUSH_TRIGGER_SIZE) {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      void flushPaintQueueRef.current?.()
      return
    }

    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    scheduleFlush(FLUSH_IDLE_MS)
  }, [activeWalletAddress, authenticated, isPending, scheduleFlush])

  const queuePixelFromPoint = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const board = boardRef.current
    if (!board) return

    const rect = board.getBoundingClientRect()
    const x = Math.floor((event.clientX - rect.left) / PIXEL_SIZE)
    const y = Math.floor((event.clientY - rect.top) / PIXEL_SIZE)

    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return
    queuePixel(y * BOARD_SIZE + x, activeColor)
  }, [activeColor, queuePixel])

  const flushPaintQueue = useCallback(async () => {
    if (!authenticated || !activeWalletAddress) return
    if (pendingPixels.current.size === 0) return
    if (isPending || submittingRef.current) return

    const batchEntries = [...pendingPixels.current.entries()]
    pendingPixels.current.clear()

    submittingRef.current = true
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
      submittingRef.current = false
      setSubmitting(false)
      if (pendingPixels.current.size > 0) {
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current)
          flushTimerRef.current = null
        }
        scheduleFlush(0)
      }
    }
  }, [activeWalletAddress, authenticated, isPending, scheduleFlush, writeContract])

  useEffect(() => {
    flushPaintQueueRef.current = flushPaintQueue
  }, [flushPaintQueue])

  const handleBoardPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!authenticated || !ready) return
    isDrawing.current = true
    boardRef.current?.setPointerCapture(event.pointerId)
    queuePixelFromPoint(event)
  }

  const handleBoardPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDrawing.current) return
    queuePixelFromPoint(event)
  }

  const handleBoardPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDrawing.current) return
    isDrawing.current = false
    boardRef.current?.releasePointerCapture(event.pointerId)
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    void flushPaintQueueRef.current?.()
  }

  const shortAddr = activeWalletAddress ? `${activeWalletAddress.slice(0, 6)}...${activeWalletAddress.slice(-4)}` : null
  const busy = isPending || submitting || !ready
  const statusClass = status.startsWith('Error:') ? 'status error' : 'status ok'
  const canDraw = authenticated && ready

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
              ref={boardRef}
              className={canDraw ? 'board interactive' : 'board disabled'}
              style={{
                gridTemplateColumns: `repeat(${BOARD_SIZE}, ${PIXEL_SIZE}px)`,
                gridTemplateRows: `repeat(${BOARD_SIZE}, ${PIXEL_SIZE}px)`,
                pointerEvents: canDraw ? 'auto' : 'none',
              }}
              onPointerDown={handleBoardPointerDown}
              onPointerMove={handleBoardPointerMove}
              onPointerUp={handleBoardPointerUp}
            >
              {pixels.map((color, i) => (
                <div
                  key={i}
                  className="cell"
                  style={{ background: color }}
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
