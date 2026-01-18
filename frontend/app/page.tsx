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
    <div className="page">
      <div className="wallet-button">
        <ConnectButton label="Connect" />
      </div>

      <header className="header">
        <h2 className="header-title">
          Costly Signals
          <br />
          Prove Conviction
        </h2>
      </header>

      <main className="main">
        {!isConnected ? (
          <section className="hero">
            <h2 className="hero-title">$2 says you mean it</h2>

            <div className="hero-input">
              <textarea
                className="belief-textarea"
                placeholder="..."
                maxLength={280}
                disabled
              />
            </div>

            <button className="btn btn-primary" disabled>
              Publish and Stake $2
            </button>

            <div className="hero-info">
              <p>If you change your mind, unstake and get your money back.</p>
            </div>
          </section>
        ) : (
          <section className="compose">
            <h2 className="compose-title">$2 says you mean it</h2>

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
                  placeholder="..."
                  maxLength={280}
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !belief.trim()}
              >
                Publish and Stake $2
              </button>

              {loading && progress > 0 && (
                <ProgressBar progress={progress} message={progressMessage} />
              )}
              {!loading && status && <p className="status">{status}</p>}
            </form>

            <div className="compose-info">
              <p>If you change your mind, unstake and get your money back.</p>
            </div>
          </section>
        )}

        <section className="beliefs">
          <h2 className="header-title">Popular Beliefs</h2>

          <ul className="beliefs-list">
            {beliefs.map((beliefItem) => {
              const totalStaked = BigInt(beliefItem.totalStaked || '0');
              const dollars = Number(totalStaked) / 1_000_000;
              const text =
                beliefTexts[beliefItem.id] || '[Test stake - no belief text]';

              return (
                <li key={beliefItem.id} className="belief-card">
                  <div className="belief-badge">
                    <span className="badge-amount">${Math.floor(dollars)}</span>
                    <span className="badge-label">Staked</span>
                  </div>
                  <div className="belief-text">{text}</div>
                  <button className="btn btn-stake" disabled>
                    <span className="stake-label">Stake</span>
                    <span className="stake-amount">$2</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}
