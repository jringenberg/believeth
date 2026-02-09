export const CONTRACTS = {
  EAS_REGISTRY: '0x4200000000000000000000000000000000000021',
  BELIEF_SCHEMA_UID:
    '0x21f7fcf4af0c022d3e7316b6a5b9a04dcaedac59eaea803251e653abd1db9fd6',
  MOCK_USDC: '0xA5c82FCFBe1274166D01B1f3cd9f69Eb79bd74E8',
  BELIEF_STAKE: '0xa37c9A89375134374a866EeD3E57EAF2789d9613',
} as const;

export const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';

// BeliefStake ABI - read functions
export const BELIEF_STAKE_ABI = [
  {
    inputs: [{ name: 'attestationUID', type: 'bytes32' }],
    name: 'getStakerCount',
    outputs: [{ name: 'count', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'attestationUID', type: 'bytes32' },
      { name: 'staker', type: 'address' },
    ],
    name: 'getStake',
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// EAS ABI for attest function
export const EAS_WRITE_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'schema', type: 'bytes32' },
          {
            components: [
              { name: 'recipient', type: 'address' },
              { name: 'expirationTime', type: 'uint64' },
              { name: 'revocable', type: 'bool' },
              { name: 'refUID', type: 'bytes32' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
            ],
            name: 'data',
            type: 'tuple',
          },
        ],
        name: 'request',
        type: 'tuple',
      },
    ],
    name: 'attest',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

// BeliefStake write functions
export const BELIEF_STAKE_WRITE_ABI = [
  {
    inputs: [{ name: 'attestationUID', type: 'bytes32' }],
    name: 'stake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'attestationUID', type: 'bytes32' }],
    name: 'unstake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// ERC20 functions
export const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const STAKE_AMOUNT = 2_000_000n; // $2 USDC (6 decimals)

