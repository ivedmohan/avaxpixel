import { avalancheFuji } from 'wagmi/chains'

export const CHAIN = avalancheFuji
export const BOARD_SIZE = 64
export const CONTRACT_ADDRESS = '0x098398b4Cd30DD4334d0c61F258dc4a400da9f57' as const
export const POLL_INTERVAL_MS = 5_000

export const SMOOTHSEND_API_KEY = (import.meta as any).env.VITE_SMOOTHSEND_API_KEY as string

export const PALETTE = [
  '#ffffff', '#000000', '#ff4500', '#ffa800', '#ffd635',
  '#00a368', '#7eed56', '#2450a4', '#3690ea', '#51e9f4',
  '#811e9f', '#b44ac0', '#ff99aa', '#9c6926', '#898d90',
  '#d4d7d9',
]
