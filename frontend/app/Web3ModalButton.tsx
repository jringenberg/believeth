'use client';

import { useWeb3Modal } from '@web3modal/wagmi/react';
import { useAccount } from 'wagmi';

export function Web3ModalButton() {
  const { open } = useWeb3Modal();
  const { address, isConnected } = useAccount();

  return (
    <button onClick={() => open()} className="btn-connect">
      {isConnected && address
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : 'Connect'}
    </button>
  );
}
