import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { avalancheFuji } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { PrivyProvider } from '@privy-io/react-auth'
import { SmoothSendAvaxProvider } from '@smoothsend/sdk/avax'
import { PRIVY_APP_ID, SMOOTHSEND_API_KEY } from './config'
import App from './App'
import './index.css'

const wagmiConfig = createConfig({
  chains: [avalancheFuji],
  connectors: [injected()],
  transports: { [avalancheFuji.id]: http() },
})

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <PrivyProvider
        appId={PRIVY_APP_ID}
        config={{
          embeddedWallets: {
            ethereum: { createOnLogin: 'all-users' },
            showWalletUIs: false,
          },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <SmoothSendAvaxProvider apiKey={SMOOTHSEND_API_KEY} network="testnet">
            <App />
          </SmoothSendAvaxProvider>
        </QueryClientProvider>
      </PrivyProvider>
    </WagmiProvider>
  </StrictMode>
)
