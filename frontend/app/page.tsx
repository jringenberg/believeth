'use client';

import { useState, useEffect } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { getBeliefs } from '@/lib/subgraph';
import { ProgressBar } from './ProgressBar';
import {
  CONTRACTS,
  EAS_ABI,
  EAS_WRITE_ABI,
  BELIEF_STAKE_WRITE_ABI,
  ERC20_ABI,
  STAKE_AMOUNT,
} from '@/lib/contracts';

export default function Home() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [belief, setBelief] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [beliefs, setBeliefs] = useState<
    Array<{
      id: string;
      totalStaked: string;
      stakerCount: number;
      createdAt: string;
    }>
  >([]);
  const [beliefTexts, setBeliefTexts] = useState<Record<string, string>>({});
  const [sortOption, setSortOption] = useState<'popular' | 'recent' | 'wallet'>('popular');
  const [showSortMenu, setShowSortMenu] = useState(false);

  useEffect(() => {
    async function fetchBeliefs() {
      try {
        const fetchedBeliefs = await getBeliefs();
        setBeliefs(fetchedBeliefs);
      } catch (error) {
        console.error('Error fetching beliefs:', error);
      }
    }

    fetchBeliefs();
  }, []);

  // Filter and sort beliefs based on selected option
  const displayedBeliefs = beliefs.filter((belief) => {
    if (sortOption === 'popular' || sortOption === 'recent') {
      // Only show beliefs with non-zero stake
      return BigInt(belief.totalStaked || '0') > 0n;
    }
    // For 'wallet' option, we'll need to check if connected and filter by user
    // For now, show all beliefs (will implement wallet filtering when we add that feature)
    return true;
  }).sort((a, b) => {
    if (sortOption === 'popular') {
      // Sort by total staked (descending)
      return Number(BigInt(b.totalStaked || '0') - BigInt(a.totalStaked || '0'));
    } else if (sortOption === 'recent') {
      // Sort by creation time (most recent first)
      return Number(b.createdAt) - Number(a.createdAt);
    }
    // Default sort (for wallet option)
    return 0;
  });

  useEffect(() => {
    async function fetchBeliefTexts() {
      if (!publicClient || beliefs.length === 0) return;

      const missingIds = beliefs
        .map((belief) => belief.id)
        .filter((id) => !beliefTexts[id]);

      if (missingIds.length === 0) return;

      try {
        const entries = await Promise.all(
          missingIds.map(async (id) => {
            try {
              const attestation = await publicClient.readContract({
                address: CONTRACTS.EAS_REGISTRY as `0x${string}`,
                abi: EAS_ABI,
                functionName: 'getAttestation',
                args: [id as `0x${string}`],
              });

              const data = attestation.data as `0x${string}`;
              if (!data || data === '0x') {
                return [id, '[Test stake - no belief text]'] as const;
              }

              const decoded = decodeAbiParameters(
                [{ name: 'belief', type: 'string' }],
                data
              );
              const decodedText = decoded[0] ?? '';

              return [
                id,
                decodedText || '[Test stake - no belief text]',
              ] as const;
            } catch (error) {
              console.error(`Error fetching belief ${id}:`, error);
              return [id, '[Test stake - no belief text]'] as const;
            }
          })
        );

        setBeliefTexts((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }));
      } catch (error) {
        console.error('Error fetching belief text:', error);
      }
    }

    fetchBeliefTexts();
  }, [beliefs, beliefTexts, publicClient]);

  async function handleCreateAndStake() {
    if (!walletClient || !publicClient || !address) return;
    if (!belief.trim()) {
      setStatus('Please enter a belief');
      return;
    }

    setLoading(true);
    setStatus('');
    setProgress(10);
    setProgressMessage('Creating attestation...');

    try {
      // Step 1: Create attestation
      const encodedData = encodeAbiParameters(
        [{ name: 'belief', type: 'string' }],
        [belief]
      );

      const attestTx = await walletClient.writeContract({
        address: CONTRACTS.EAS_REGISTRY as `0x${string}`,
        abi: EAS_WRITE_ABI,
        functionName: 'attest',
        args: [
          {
            schema: CONTRACTS.BELIEF_SCHEMA_UID as `0x${string}`,
            data: {
              recipient:
                '0x0000000000000000000000000000000000000000' as `0x${string}`,
              expirationTime: 0n,
              revocable: false,
              refUID:
                '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
              data: encodedData,
              value: 0n,
            },
          },
        ],
      });

      setProgress(20);
      setProgressMessage('Confirming attestation...');

      const attestReceipt = await publicClient.waitForTransactionReceipt({
        hash: attestTx,
      });

      setProgress(30);

      // Parse attestation UID from the Attested event data
      const attestedLog = attestReceipt.logs[0];
      const decodedUid = decodeAbiParameters(
        [{ name: 'uid', type: 'bytes32' }],
        attestedLog.data as `0x${string}`
      );
      const attestationUID = decodedUid[0];
      if (!attestationUID) throw new Error('Failed to get attestation UID');

      // Step 2: Approve USDC
      setProgress(40);
      setProgressMessage('Approving USDC...');

      const approveTx = await walletClient.writeContract({
        address: CONTRACTS.MOCK_USDC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.BELIEF_STAKE as `0x${string}`, STAKE_AMOUNT],
      });

      setProgress(50);
      setProgressMessage('Confirming approval...');
      await publicClient.waitForTransactionReceipt({
        hash: approveTx,
        confirmations: 2,
      });

      // Step 3: Stake
      setProgress(60);
      setProgressMessage('Staking $2...');

      const stakeTx = await walletClient.writeContract({
        address: CONTRACTS.BELIEF_STAKE as `0x${string}`,
        abi: BELIEF_STAKE_WRITE_ABI,
        functionName: 'stake',
        args: [attestationUID],
      });

      setProgress(70);
      setProgressMessage('Confirming stake...');
      await publicClient.waitForTransactionReceipt({ hash: stakeTx });

      // Poll subgraph for new belief
      setProgress(90);
      setProgressMessage('Processing your belief...');
      setBelief('');

      // Poll for the new attestation in subgraph
      const maxAttempts = 20;
      let attempts = 0;
      let found = false;

      while (attempts < maxAttempts && !found) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        try {
          const latestBeliefs = await getBeliefs();
          found = latestBeliefs.some((b) => b.id === attestationUID);

          if (found) {
            setProgress(100);
            setProgressMessage('Belief created! Refreshing...');
            setTimeout(() => {
              window.location.reload();
            }, 1000);
            break;
          }
        } catch (error) {
          console.error('Error polling subgraph:', error);
        }

        attempts++;
        const progressIncrement = (99 - 90) / maxAttempts;
        setProgress(90 + progressIncrement * attempts);
      }

      if (!found) {
        setProgress(99);
        setProgressMessage('Almost there - refresh to see your belief');
      }
    } catch (error: unknown) {
      console.error('Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      setStatus(`❌ ${errorMessage}`);
      setProgress(0);
      setProgressMessage('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="sticky-header">
        <button className="dollar-button" disabled>
          $
        </button>
        <div className="wallet-button">
          <ConnectButton label="Connect Wallet" />
        </div>
      </header>

      <div className="page">
        <main className="main">
        {!isConnected ? (
          <section className="hero">
            <h2 className="hero-title">
              $2 says you mean it. The fact that it costs money to make a claim
              shows that it has value and you&apos;re not just yapping. You have
              conviction.
            </h2>

            <div className="hero-input">
              <textarea
                className="belief-textarea"
                placeholder="about..."
                maxLength={280}
                disabled
              />
            </div>

            <button className="btn btn-primary" disabled>
              Attest and Stake $2
            </button>

            <div className="hero-info">
              <p>
                If you change your mind, unstake and take your money back.
                There is no resolution, no reward. Just the fact that you said
                it onchain, timestamped, verifiable forever.
              </p>
            </div>
          </section>
        ) : (
          <section className="compose">
            <h2 className="compose-title">
              $2 says you mean it. The fact that it costs money to make a claim
              shows that it has value and you&apos;re not just yapping. You have
              conviction.
            </h2>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateAndStake();
              }}
            >
              <div className="compose-input">
                <textarea
                  className="belief-textarea"
                  value={belief}
                  onChange={(e) => setBelief(e.target.value)}
                  placeholder="about..."
                  maxLength={280}
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !belief.trim()}
              >
                Attest and Stake $2
              </button>

              {loading && progress > 0 && (
                <ProgressBar progress={progress} message={progressMessage} />
              )}
              {!loading && status && <p className="status">{status}</p>}
            </form>

            <div className="compose-info">
              <p>
                If you change your mind, unstake and take your money back.
                There is no resolution, no reward. Just the fact that you said
                it onchain, timestamped, verifiable forever.
              </p>
            </div>
          </section>
        )}

        <section className="beliefs">
          <div className="sort-dropdown">
            <button
              className="sort-button"
              onClick={() => setShowSortMenu(!showSortMenu)}
            >
              {sortOption === 'popular' && 'Popular Beliefs'}
              {sortOption === 'recent' && 'Recent Beliefs'}
              {sortOption === 'wallet' && 'Connected Wallet'}
              <span className="dropdown-arrow">{showSortMenu ? '▲' : '▼'}</span>
            </button>
            {showSortMenu && (
              <ul className="sort-menu">
                <li>
                  <button
                    onClick={() => {
                      setSortOption('popular');
                      setShowSortMenu(false);
                    }}
                  >
                    Popular Beliefs
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => {
                      setSortOption('recent');
                      setShowSortMenu(false);
                    }}
                  >
                    Recent Beliefs
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => {
                      setSortOption('wallet');
                      setShowSortMenu(false);
                    }}
                  >
                    Connected Wallet
                  </button>
                </li>
              </ul>
            )}
          </div>

          <ul className="beliefs-list">
            {displayedBeliefs.map((beliefItem) => {
              const totalStaked = BigInt(beliefItem.totalStaked || '0');
              const dollars = Number(totalStaked) / 1_000_000;
              const text =
                beliefTexts[beliefItem.id] || '[Test stake - no belief text]';

              return (
                <li key={beliefItem.id} className="belief-card">
                  <div className="belief-text">{text}</div>
                  <div className="belief-footer">
                    <div className="belief-amount">${Math.floor(dollars)}</div>
                    <button className="btn-stake" disabled>
                      Stake $2
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
      </div>
    </>
  );
}
