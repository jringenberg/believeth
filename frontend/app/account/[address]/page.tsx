'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import { isAddress } from 'viem';
import { getAccountStakes, type Belief, type Stake } from '@/lib/subgraph';
import { AddressDisplay } from '@/components/AddressDisplay';
import Link from 'next/link';

function formatTimeAgo(timestamp: string): string {
  const now = Date.now();
  const then = parseInt(timestamp) * 1000;
  const diff = now - then;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 5) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  
  const date = new Date(then);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AccountPage() {
  const params = useParams();
  const urlAddress = params.address as string;
  const { address: connectedAddress } = useAccount();

  const [stakes, setStakes] = useState<(Stake & { belief: Belief })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isOwnAccount = connectedAddress?.toLowerCase() === urlAddress?.toLowerCase();

  useEffect(() => {
    async function fetchData() {
      if (!urlAddress) return;

      if (!isAddress(urlAddress)) {
        setError('Invalid address');
        setLoading(false);
        return;
      }

      try {
        const stakesData = await getAccountStakes(urlAddress);
        setStakes(stakesData);
      } catch (err) {
        console.error('Error fetching account:', err);
        setError('Failed to load account');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [urlAddress]);

  if (loading) {
    return (
      <div className="page">
        <header className="sticky-header">
          <Link href="/" className="dollar-button">$</Link>
        </header>
        <main className="main">
          <p>Loading...</p>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <header className="sticky-header">
          <Link href="/" className="dollar-button">$</Link>
        </header>
        <main className="main">
          <p>{error}</p>
          <Link href="/" className="breadcrumb-link">← Back to all beliefs</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="sticky-header">
        <Link href="/" className="dollar-button">$</Link>
      </header>
      
      <main className="main">
        <nav className="breadcrumb">
          <Link href="/" className="breadcrumb-link">← All beliefs</Link>
        </nav>

        <header className="account-header">
          <h1 className="account-title">{isOwnAccount ? 'Your beliefs' : 'Beliefs backed by'}</h1>
          <p className="account-address">
            <AddressDisplay address={urlAddress as `0x${string}`} truncate={false} />
          </p>
        </header>

        {stakes.length === 0 ? (
          <p className="empty-state">
            {isOwnAccount 
              ? "You haven't backed any beliefs yet." 
              : "This account hasn't backed any beliefs yet."}
          </p>
        ) : (
          <ul className="belief-list">
            {stakes.map((stake) => {
              const belief = stake.belief;
              const dollars = Number(belief.totalStaked) / 1_000_000;
              const isCreator = belief.attester.toLowerCase() === urlAddress.toLowerCase();

              return (
                <li key={stake.id} className="belief-card">
                  <Link href={`/belief/${belief.id}`} className="belief-link">
                    <div className="belief-text">{belief.beliefText || '[No belief text]'}</div>
                  </Link>
                  
                  <p className="belief-meta">
                    {isCreator ? (
                      <span className="badge-creator">created</span>
                    ) : (
                      <>
                        by <AddressDisplay address={belief.attester as `0x${string}`} linkToAccount />
                      </>
                    )}
                    {' · '}
                    {formatTimeAgo(belief.createdAt)}
                  </p>

                  <p className="belief-stats">
                    ${Math.floor(dollars)} · {belief.stakerCount} {belief.stakerCount === 1 ? 'backer' : 'backers'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
