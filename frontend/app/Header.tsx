'use client';

import { memo } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useDisconnect } from 'wagmi';

interface HeaderProps {
  onDollarClick: () => void;
  isInverted: boolean;
  isConnected: boolean;
  showEmergencyDisconnect: boolean;
}

export const Header = memo(function Header({ 
  onDollarClick, 
  isInverted, 
  isConnected, 
  showEmergencyDisconnect 
}: HeaderProps) {
  const { disconnect } = useDisconnect();

  const handleEmergencyDisconnect = () => {
    console.log('[Emergency Disconnect] Clearing wallet state...');
    disconnect();
    // Clear any stuck states
    localStorage.removeItem('wagmi.store');
    localStorage.removeItem('wagmi.recentConnectorId');
    localStorage.removeItem('wagmi.cache');
    localStorage.removeItem('wagmi.connected');
    sessionStorage.clear();
    
    // Reload after a tiny delay to ensure disconnect completes
    setTimeout(() => {
      window.location.reload();
    }, 100);
  };

  return (
    <header className="sticky-header">
      <button 
        className={`dollar-button ${isInverted ? 'inverted' : ''}`}
        onClick={onDollarClick}
        title="Get test funds"
      >
        $
      </button>
      <div className="wallet-button">
        <ConnectButton 
          label="Connect"
          showBalance={false}
          chainStatus="none"
          accountStatus="address"
        />
      </div>
      {isConnected && showEmergencyDisconnect && (
        <button
          className="emergency-disconnect"
          onClick={handleEmergencyDisconnect}
          title="Emergency disconnect - wallet appears stuck"
        >
          ⚠️
        </button>
      )}
    </header>
  );
});
