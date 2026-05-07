'use client';

import { useWalletClient, usePublicClient } from 'wagmi';
import { useCallback } from 'react';
import { parseEther, parseUnits, encodeFunctionData } from 'viem';
import { api } from './api';

export interface RouteParams {
  chain:       string;
  token:       string;
  amount:      string;
  destination: string;
}

const delay    = (ms: number) => new Promise(r => setTimeout(r, ms));
const mockHash = () => `0x${[...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

// ERC20 approve ABI — used to request wallet signature for token approval
const ERC20_APPROVE_ABI = [{
  name: 'approve',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount',  type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

// ArcRoute spender address (placeholder — replace with real contract)
const ARCROUTE_SPENDER = '0x0000000000000000000000000000000000000001' as `0x${string}`;

// Token contract addresses per chain
const TOKEN_ADDRESSES: Record<string, Record<string, `0x${string}`>> = {
  Ethereum_Sepolia: {
    USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    USDT: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
  },
  BNB_Testnet: {
    USDC: '0x64544969ed7EBf5f083679233325356EbE738930',
    USDT: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
  },
  Base_Sepolia: {
    USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    USDT: '0x4D3D0e25b0E1E6B1E2D2A5A6B8b5E3e1E1e1e1e',
  },
};

export function useArcRoute() {
  const { data: walletClient } = useWalletClient();
  const publicClient           = usePublicClient();

  const route = useCallback(async (params: RouteParams): Promise<string> => {
    if (!walletClient) throw new Error('Wallet not connected');

    const { chain, token, amount, destination } = params;

    // ── Step 1: Request wallet signature / approval ───────────────────────────
    // For ERC20 tokens → request an approve() signature
    // For native tokens (ETH/BNB) → send a tiny self-transfer to confirm intent
    const tokenAddress = TOKEN_ADDRESSES[chain]?.[token];
    const isNative     = token === 'ETH' || token === 'BNB';

    if (isNative) {
      // Native token: sign a 0-value message to confirm intent
      // This pops MetaMask open so the user sees and approves
      await walletClient.signMessage({
        message: `ArcRoute: I authorize converting ${amount} ${token} to USDC on Arc Testnet.\n\nDestination: ${destination}\n\nThis is a testnet transaction.`,
      });
    } else if (tokenAddress) {
      // ERC20: request approve() — this triggers MetaMask with full tx details
      const decimals   = token === 'USDC' || token === 'USDT' ? 6 : 18;
      const amountBig  = parseUnits(amount, decimals);

      await walletClient.writeContract({
        address:      tokenAddress,
        abi:          ERC20_APPROVE_ABI,
        functionName: 'approve',
        args:         [ARCROUTE_SPENDER, amountBig],
      });
    }

    // ── Step 2: Create backend tracking record ────────────────────────────────
    const tx = await api.createTransaction({ chain, token, amount, destination });
    const id  = tx.transactionId;

    try {
      // ── Step 3: SWAP ──────────────────────────────────────────────────────
      if (token !== 'USDC') {
        await api.updateStep(id, { step: 'overall', status: 'swapping' });
        await api.updateStep(id, { step: 'swap',    status: 'pending'  });
        // TODO: Replace with real kit.swap() when Circle App Kit is available
        await delay(1500);
        await api.updateStep(id, { step: 'swap', status: 'done', txHash: mockHash() });
      } else {
        await api.updateStep(id, { step: 'swap', status: 'skipped' });
      }

      // ── Step 4: BRIDGE ────────────────────────────────────────────────────
      if (chain !== 'Arc_Testnet') {
        await api.updateStep(id, { step: 'overall', status: 'bridging' });
        await api.updateStep(id, { step: 'bridge',  status: 'pending'  });
        // TODO: Replace with real Circle CCTP bridge call
        await delay(2000);
        await api.updateStep(id, { step: 'bridge', status: 'done', txHash: mockHash() });
      } else {
        await api.updateStep(id, { step: 'bridge', status: 'skipped' });
      }

      // ── Step 5: SEND ──────────────────────────────────────────────────────
      await api.updateStep(id, { step: 'overall', status: 'sending' });
      await api.updateStep(id, { step: 'send',    status: 'pending'  });
      // TODO: Replace with real kit.send() call
      await delay(1000);
      await api.updateStep(id, { step: 'send',    status: 'done',      txHash: mockHash() });
      await api.updateStep(id, { step: 'overall', status: 'completed'              });

    } catch (err: any) {
      await api.updateStep(id, { step: 'overall', status: 'failed', error: String(err) });
      throw err;
    }

    return id;
  }, [walletClient, publicClient]);

  return { route };
}
