import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useAccount, useConnect, useDisconnect, usePublicClient, useWalletClient } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { parseAbi } from 'viem'
import { useSmoothSendWrite } from '@smoothsend/sdk/avax'
import { packPixelUpdate } from './pixelPacking'
import { usePixelSync } from './usePixelSync'
import { BOARD_SIZE, CONTRACT_ADDRESS, PALETTE } from './config'

const contractAbi = parseAbi([
  'function paintPixels(uint40[] packed) external',
  'function getCanvas() external view returns (uint24[4096])',
])

const PIXEL_SIZE = 9
const EMPTY = '#ffffff'

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
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending: isConnecting } = useConnect()
  const { disconnect } = useDisconnect()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const { writeContract, isPending } = useSmoothSendWrite({
    apiKey: (import.meta as any).env.VITE_SMOOTHSEND_API_KEY as string,
    publicClient,
    walletClient: walletClient ?? undefined,
    ownerAddress: address as `0x${string}` | undefined,
  })

  const [pixels, setPixels] = useState<string[]>(makeGrid)
  const [selectedColor, setSelectedColor] = useState(PALETTE[2])
  const [isEraser, setIsEraser] = useState(false)
  const [status, setStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isDrawing = useRef(false)
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

  const submitPixel = async (index: number, color: string) => {
    if (!isConnected || !address) return
    if (isPending || submitting) return

    const x = index % BOARD_SIZE
    const y = Math.floor(index / BOARD_SIZE)
    setSubmitting(true)
    setStatus('Placing pixel...')

    try {
      const packed = packPixelUpdate(x, y, color)
      await writeContract({
        abi: contractAbi,
        address: CONTRACT_ADDRESS,
        functionName: 'paintPixels',
        args: [[packed]],
        mode: 'developer-sponsored',
      })
      setStatus('Pixel placed.')
      setTimeout(() => setStatus(''), 1800)
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string }
      setStatus(`Error: ${err?.shortMessage || err?.message || 'Unknown error'}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleMouseDown = (index: number) => {
    isDrawing.current = true
    setPixels(prev => {
      const next = [...prev]
      next[index] = activeColor
      return next
    })
    submitPixel(index, activeColor)
  }

  const handleMouseEnter = (index: number) => {
    if (!isDrawing.current) return
    setPixels(prev => {
      const next = [...prev]
      next[index] = activeColor
      return next
    })
  }

  const handleMouseUp = () => {
    isDrawing.current = false
  }

  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null
  const busy = isPending || submitting || isConnecting
  const statusClass = status.startsWith('Error:') ? 'status error' : 'status ok'
  const canDraw = isConnected && !busy

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
              {isConnected ? (
                <button className="btn ghost" onClick={() => disconnect()}>Disconnect</button>
              ) : (
                <button
                  className="btn primary"
                  onClick={() => connect({ connector: connectors[0] ?? injected() })}
                >
                  Connect wallet
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

          {!isConnected && (
            <div className="notice">
              Connect a wallet to paint. SmoothSend sponsors gas automatically for supported transactions.
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
              }}
              onMouseLeave={handleMouseUp}
              onMouseUp={handleMouseUp}
            >
              {pixels.map((color, i) => (
                <div
                  key={i}
                  className="cell"
                  style={{ background: color }}
                  onMouseDown={() => isConnected && handleMouseDown(i)}
                  onMouseEnter={() => handleMouseEnter(i)}
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
