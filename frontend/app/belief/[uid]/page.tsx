'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getBelief, getBeliefStakes, type Belief, type Stake } from '@/lib/subgraph';
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

export default function BeliefPage() {
  const params = useParams();
  const uid = params.uid as string;

  const [belief, setBelief] = useState<Belief | null>(null);
  const [stakes, setStakes] = useState<Stake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!uid) return;

      try {
        const [beliefData, stakesData] = await Promise.all([
          getBelief(uid),
          getBeliefStakes(uid),
        ]);

        if (!beliefData) {
          setError('Belief not found');
        } else {
          setBelief(beliefData);
          setStakes(stakesData);
        }
      } catch (err) {
        console.error('Error fetching belief:', err);
        setError('Failed to load belief');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [uid]);

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

  if (error || !belief) {
    return (
      <div className="page">
        <header className="sticky-header">
          <Link href="/" className="dollar-button">$</Link>
        </header>
        <main className="main">
          <p>{error || 'Belief not found'}</p>
          <Link href="/" className="breadcrumb-link">← Back to all beliefs</Link>
        </main>
      </div>
    );
  }

  const dollars = Number(belief.totalStaked) / 1_000_000;

  return (
    <div className="page">
      <header className="sticky-header">
        <Link href="/" className="dollar-button">$</Link>
      </header>
      
      <main className="main">
        <nav className="breadcrumb">
          <Link href="/" className="breadcrumb-link">← All beliefs</Link>
        </nav>

        <article className="belief-detail">
          <h1 className="belief-detail-text">{belief.beliefText || '[No belief text]'}</h1>
          
          <p className="belief-detail-meta">
            Created by <AddressDisplay address={belief.attester as `0x${string}`} linkToAccount />
            {' · '}
            {formatTimeAgo(belief.createdAt)}
          </p>

          <p className="belief-detail-stats">
            ${Math.floor(dollars)} staked · {belief.stakerCount} {belief.stakerCount === 1 ? 'backer' : 'backers'}
          </p>
        </article>

        {stakes.length > 0 && (
          <section className="stakes-section">
            <h2>Backers</h2>
            <table className="stakes-table">
              <tbody>
                {stakes.map((stake) => {
                  const isCreator = stake.staker.toLowerCase() === belief.attester.toLowerCase();
                  const stakeDollars = Number(stake.amount) / 1_000_000;
                  
                  return (
                    <tr key={stake.id} className={!stake.active ? 'stake-inactive' : ''}>
                      <td className="stake-amount">${Math.floor(stakeDollars)}</td>
                      <td className="stake-address">
                        <AddressDisplay address={stake.staker as `0x${string}`} linkToAccount />
                        {isCreator && <span className="badge-creator">created</span>}
                        {!stake.active && <span className="badge-unstaked">unstaked</span>}
                      </td>
                      <td className="stake-time">{formatTimeAgo(stake.stakedAt)}</td>
                      <td className="stake-tx">
                        <a 
                          href={`https://sepolia.basescan.org/tx/${stake.transactionHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          tx
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
