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
  GENESIS_BELIEF_UID,
  STAKE_AMOUNT,
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

  useEffect(() => {
    async function fetchBeliefs() {
      if (!publicClient) return;

      try {
        // Get all Staked events from the BeliefStake contract
        // Start from block where contract was deployed (adjust if needed)
        const stakedEvents = await publicClient.getLogs({
          address: CONTRACTS.BELIEF_STAKE as `0x${string}`,
          event: parseAbiItem(
            'event Staked(bytes32 indexed attestationUID, address indexed staker, uint256 amount, uint256 timestamp)'
          ),
          fromBlock: 36238181n, // Block where BeliefStake was deployed
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

        console.log('Found beliefs with stakes:', uniqueUIDs);

        // Fetch each belief's data
        const fetchedBeliefs = await Promise.all(
          uniqueUIDs.map(async (uid) => {
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
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold">OnRecord</h1>
          <ConnectButton />
        </div>

        {/* Create Form */}
        {isConnected && (
          <div className="border border-gray-200 rounded-lg p-6 space-y-4">
            <h2 className="text-xl font-semibold">Create a Belief</h2>
            <textarea
              value={belief}
              onChange={(e) => setBelief(e.target.value)}
              placeholder="Enter your belief... (e.g. 'AI will be smarter than humans by 2030')"
              className="w-full p-3 border border-gray-300 rounded-lg resize-none h-24"
              maxLength={280}
              disabled={loading}
            />
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">{belief.length}/280</span>
              <button
                onClick={handleCreateAndStake}
                disabled={loading || !belief.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {loading ? status : 'Back This $2'}
              </button>
            </div>
            {status && !loading && <p className="text-sm text-gray-600">{status}</p>}
          </div>
        )}

        {/* Popular Beliefs */}
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Popular Beliefs</h2>
          {beliefs.map((b) => (
            <div
              key={b.uid}
              className="border border-gray-200 rounded-lg p-6 space-y-2"
            >
              <p className="text-lg">{b.text}</p>
              <p className="text-sm text-gray-600">
                <span className="font-semibold">{b.stakers}</span>{' '}
                {b.stakers === 1 ? 'person' : 'people'} staked $2
              </p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
