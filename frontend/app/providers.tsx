'use client';

import { getDefaultConfig, RainbowKitProvider, lightTheme, AvatarComponent } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ChainGuard } from './ChainGuard';
import { ErrorSuppressor } from './ErrorSuppressor';

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ??
  'f663d58e37395d5dad4d6ba0fe9fd134';

const config = getDefaultConfig({
  appName: 'Believeth',
  projectId: walletConnectProjectId,
  chains: [baseSepolia],
  ssr: true,
});

const appInfo = {
  appName: 'Believeth',
  learnMoreUrl: 'https://believeth.xyz',
};

const customTheme = lightTheme({
  accentColor: '#FFFBEA',
  accentColorForeground: '#000',
  borderRadius: 'medium',
  overlayBlur: 'small',
  fontStack: 'system',
});

// Custom avatar that returns null (no avatar)
const CustomAvatar: AvatarComponent = () => null;

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider 
          appInfo={appInfo} 
          initialChain={baseSepolia}
          theme={customTheme}
          avatar={CustomAvatar}
        >
          <ErrorSuppressor />
          <ChainGuard />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

