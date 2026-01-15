'use client';

import { useState, useEffect } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { decodeAbiParameters, encodeAbiParameters, parseAbiItem } from 'viem';
import {
  CONTRACTS,
  EAS_ABI,
  EAS_WRITE_ABI,
  BELIEF_STAKE_ABI,
  BELIEF_STAKE_WRITE_ABI,
  ERC20_ABI,
  STAKE_AMOUNT,
  GENESIS_BELIEF_UID,
} from '@/lib/contracts';

export default function Home() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [belief, setBelief] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [beliefs, setBeliefs] = useState<
    Array<{ uid: string; text: string; stakers: number }>
  >([]);
  const statusClass = status.startsWith('✅')
    ? 'status success'
    : status.startsWith('❌')
      ? 'status error'
      : 'status';

  useEffect(() => {
    async function fetchBeliefs() {
      if (!publicClient) return;

      try {
        const currentBlock = await publicClient.getBlockNumber();
        const fromBlock = currentBlock > 10000n ? currentBlock - 10000n : 0n;

        // Get all Staked events from the BeliefStake contract
        const stakedEvents = await publicClient.getLogs({
          address: CONTRACTS.BELIEF_STAKE as `0x${string}`,
          event: parseAbiItem(
            'event Staked(bytes32 indexed attestationUID, address indexed staker, uint256 amount, uint256 timestamp)'
          ),
          fromBlock,
          toBlock: 'latest',
        });

        // Extract unique attestation UIDs
        const uniqueUIDs = [
          ...new Set(
            stakedEvents.map(
              (event) => event.args.attestationUID as `0x${string}`
            )
          ),
        ];

        const beliefUIDs =
          uniqueUIDs.length > 0
            ? uniqueUIDs
            : [GENESIS_BELIEF_UID as `0x${string}`];

        console.log('Found beliefs with stakes:', beliefUIDs);

        // Fetch each belief's data
        const fetchedBeliefs = await Promise.all(
          beliefUIDs.map(async (uid) => {
            try {
              // Fetch attestation
              const attestation = await publicClient.readContract({
                address: CONTRACTS.EAS_REGISTRY as `0x${string}`,
                abi: EAS_ABI,
                functionName: 'getAttestation',
                args: [uid],
              });

              // Decode belief text
              const decoded = decodeAbiParameters(
                [{ name: 'belief', type: 'string' }],
                attestation.data as `0x${string}`
              );

              // Fetch staker count
              const count = await publicClient.readContract({
                address: CONTRACTS.BELIEF_STAKE as `0x${string}`,
                abi: BELIEF_STAKE_ABI,
                functionName: 'getStakerCount',
                args: [uid],
              });

              return {
                uid,
                text: decoded[0],
                stakers: Number(count),
              };
            } catch (error) {
              console.error(`Error fetching belief ${uid}:`, error);
              return null;
            }
          })
        );

        // Filter out any failed fetches and sort by staker count (descending)
        const validBeliefs = fetchedBeliefs
          .filter((b): b is NonNullable<typeof b> => b !== null)
          .sort((a, b) => b.stakers - a.stakers);

        setBeliefs(validBeliefs);
      } catch (error) {
        console.error('Error fetching beliefs:', error);
      }
    }

    fetchBeliefs();
  }, [publicClient]);

  async function handleCreateAndStake() {
    if (!walletClient || !publicClient || !address) return;
    if (!belief.trim()) {
      setStatus('Please enter a belief');
      return;
    }

    setLoading(true);
    setStatus('');

    try {
      // Step 1: Create attestation
      setStatus('Step 1/3: Creating attestation...');

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

      const attestReceipt = await publicClient.waitForTransactionReceipt({
        hash: attestTx,
      });

      // Parse attestation UID from the Attested event data
      // The UID is in the data field, not topics
      const attestedLog = attestReceipt.logs[0];
      const decodedUid = decodeAbiParameters(
        [{ name: 'uid', type: 'bytes32' }],
        attestedLog.data as `0x${string}`
      );
      const attestationUID = decodedUid[0];
      if (!attestationUID) throw new Error('Failed to get attestation UID');

      console.log('Extracted attestation UID:', attestationUID);

      // Step 2: Approve USDC
      setStatus('Step 2/3: Approving USDC...');

      const approveTx = await walletClient.writeContract({
        address: CONTRACTS.MOCK_USDC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.BELIEF_STAKE as `0x${string}`, STAKE_AMOUNT],
      });

      // Wait for 2 block confirmations to ensure approval is settled
      setStatus('Step 2/3: Waiting for approval confirmation...');
      await publicClient.waitForTransactionReceipt({
        hash: approveTx,
        confirmations: 2,
      });

      // Step 3: Stake
      setStatus('Step 3/3: Staking $2...');

      const stakeTx = await walletClient.writeContract({
        address: CONTRACTS.BELIEF_STAKE as `0x${string}`,
        abi: BELIEF_STAKE_WRITE_ABI,
        functionName: 'stake',
        args: [attestationUID],
      });

      await publicClient.waitForTransactionReceipt({ hash: stakeTx });

      // Success!
      setStatus('✅ Belief created and staked!');
      setBelief('');

      // Reload page to refresh belief list
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error: any) {
      console.error('Error:', error);
      setStatus(`❌ Error: ${error.message || 'Transaction failed'}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="wallet-float">
        <ConnectButton />
      </div>
      <main className="page">
        <header className="page-header">
          <h1 className="page-title">Popular beliefs</h1>
        </header>

        <section className="beliefs">
          <div className="belief-list">
            {beliefs.map((b) => (
              <article key={b.uid} className="belief-row">
                <div className="belief-core">
                  <aside className="belief-amount">
                    <span className="amount-value">${b.stakers * 2}</span>
                    <span className="amount-label">staked</span>
                  </aside>
                  <div className="belief-body">
                    <p className="belief-text">{b.text}</p>
                  </div>
                </div>
                <button type="button" className="belief-cta" disabled>
                  + $2
                </button>
              </article>
            ))}
          </div>
        </section>

        {isConnected && (
          <section className="compose">
            <h2 className="section-title">Write your own...</h2>
            <form
              className="compose-form"
              onSubmit={(event) => {
                event.preventDefault();
                handleCreateAndStake();
              }}
            >
              <div className="compose-input">
                <textarea
                  id="belief-input"
                  className="compose-textarea"
                  value={belief}
                  onChange={(event) => setBelief(event.target.value)}
                  placeholder="Enter your belief..."
                  maxLength={280}
                  disabled={loading}
                />
                <button
                  type="submit"
                  className="compose-submit"
                  disabled={loading || !belief.trim()}
                >
                  + $2
                </button>
              </div>
              {status && <p className={statusClass}>{status}</p>}
            </form>
          </section>
        )}

        <section className="how-it-works">
          <h2 className="section-title">How it works</h2>
          <div className="how-it-works-list">
            <p className="how-it-works-item">
              Stake $2 to make a claim. Revoke anytime and get your money back.
            </p>
            <p className="how-it-works-item">
              Cheap talk is for bots and trolls. Beliefs are costly, and even a
              small, refundable cost proves conviction.
            </p>
            <p className="how-it-works-item">
              Using the blockchain to record beliefs means that they are
              verifiable, public, tamper proof, provable, and censorship
              resistant.
            </p>
            <p className="how-it-works-item">
              Beliefs are EAS attestations on Base chain. The gas cost of
              creating a new belief is about 25¢. Adding your stake to an
              existing belief costs about 10¢. While staked, beliefs generate
              yield held by a protocol treasury.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
