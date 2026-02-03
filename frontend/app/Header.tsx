'use client';

import { memo } from 'react';
import { Web3ModalButton } from './Web3ModalButton';

interface HeaderProps {
  onDollarClick: () => void;
  isInverted: boolean;
  isConnected: boolean;
}

export const Header = memo(function Header({ 
  onDollarClick, 
  isInverted, 
  isConnected
}: HeaderProps) {
  return (
    <header className="sticky-header">
      <button 
        className={`dollar-button ${isInverted ? 'inverted' : ''}`}
        onClick={onDollarClick}
        title="Get test funds"
      >
        $
      </button>
      <Web3ModalButton />
    </header>
  );
});
