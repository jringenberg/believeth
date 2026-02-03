'use client';

import { createWeb3Modal } from '@web3modal/wagmi/react';
import { defaultWagmiConfig } from '@web3modal/wagmi';
import { WagmiProvider } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ??
  'f663d58e37395d5dad4d6ba0fe9fd134';

// Web3Modal configuration
const metadata = {
  name: 'Believeth',
  description: 'Stake beliefs onchain',
  url: 'https://extracredible.xyz',
  icons: ['https://extracredible.xyz/icon.png'],
};

// Create wagmi config using Web3Modal's helper
const config = defaultWagmiConfig({
  chains: [baseSepolia],
  projectId: walletConnectProjectId,
  metadata,
});

// Create the Web3Modal instance
createWeb3Modal({
  wagmiConfig: config,
  projectId: walletConnectProjectId,
  themeMode: 'light',
  themeVariables: {
    '--w3m-accent': '#002FA7', // Klein Blue
    '--w3m-border-radius-master': '0px', // Sharp corners to match your design
  },
});

// Create QueryClient outside component
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
