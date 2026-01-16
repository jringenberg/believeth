'use client';

import { useEffect, useRef } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';

export function ChainGuard() {
  const { chain, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const hasSwitched = useRef(false);

  useEffect(() => {
    // Only switch once per session and only if on wrong chain
    if (
      isConnected &&
      chain &&
      chain.id !== baseSepolia.id &&
      !hasSwitched.current
    ) {
      console.log(
        `Wrong chain detected: ${chain.id}. Switching to Base Sepolia (${baseSepolia.id})...`
      );
      hasSwitched.current = true;
      switchChain?.({ chainId: baseSepolia.id });
    }
  }, [isConnected, chain, switchChain]);

  return null;
}
