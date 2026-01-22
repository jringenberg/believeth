'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';

export function ChainGuard() {
  const { chain, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const hasSwitched = useRef(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isConnected || hasSwitched.current) return;

    // Handle missing chain (Rainbow Wallet "Network: None" issue)
    if (!chain && retryCount < 3) {
      console.log(`[ChainGuard] No chain detected (attempt ${retryCount + 1}/3). Attempting to switch to Base Sepolia...`);
      const timer = setTimeout(() => {
        switchChain?.({ chainId: baseSepolia.id });
        setRetryCount(prev => prev + 1);
      }, 500 * (retryCount + 1)); // Exponential backoff: 500ms, 1000ms, 1500ms
      
      return () => clearTimeout(timer);
    }

    // Handle wrong chain
    if (chain && chain.id !== baseSepolia.id) {
      console.log(
        `[ChainGuard] Wrong chain detected: ${chain.id}. Switching to Base Sepolia (${baseSepolia.id})...`
      );
      hasSwitched.current = true;
      switchChain?.({ chainId: baseSepolia.id });
    }

    // Success case - correct chain detected
    if (chain && chain.id === baseSepolia.id) {
      console.log('[ChainGuard] Correct chain detected (Base Sepolia)');
      hasSwitched.current = true;
      setRetryCount(0);
    }
  }, [isConnected, chain, switchChain, retryCount]);

  // Reset on disconnect
  useEffect(() => {
    if (!isConnected) {
      hasSwitched.current = false;
      setRetryCount(0);
    }
  }, [isConnected]);

  return null;
}
