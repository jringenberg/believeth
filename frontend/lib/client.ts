import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { BASE_RPC } from './contracts';

export const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC),
});

