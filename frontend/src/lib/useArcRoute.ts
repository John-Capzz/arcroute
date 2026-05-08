'use client';

import { useWalletClient, usePublicClient } from 'wagmi';
import { useCallback } from 'react';
import { api } from './api';

export interface RouteParams {
  chain:       string;
  token:       string;
  amount:      string;
  destination: string;
}

// ── App Kit chain name mapping ─────────────────────────────────────────────────
const APP_KIT_CHAIN: Record<string, string> = {
  Ethereum_Sepolia: 'Ethereum_Sepolia',
  BNB_Testnet:      'BNB_Testnet',
  Base_Sepolia:     'Base_Sepolia',
  Arc_Testnet:      'Arc_Testnet',
};

// ── Token mapping ──────────────────────────────────────────────────────────────
const APP_KIT_TOKEN: Record<string, string> = {
  ETH:  'NATIVE',
  BNB:  'NATIVE',
  USDC: 'USDC',
  USDT: 'USDT',
};

export function useArcRoute() {
  const { data: walletClient } = useWalletClient();
  const publicClient           = usePublicClient();

  const route = useCallback(async (params: RouteParams): Promise<string> => {
    if (!walletClient) throw new Error('Wallet not connected');

    const { chain, token, amount, destination } = params;
    const appKitChain = APP_KIT_CHAIN[chain];
    const appKitToken = APP_KIT_TOKEN[token] ?? token;

    if (!appKitChain) throw new Error(`Unsupported chain: ${chain}`);

    // ── 1. Create backend tracking record ─────────────────────────────────────
    const tx        = await api.createTransaction({ chain, token, amount, destination });
    const id        = tx.transactionId;
    const netAmount = tx.estimatedOutput;

    try {
      // ── 2. Load Circle App Kit + correct viem adapter ─────────────────────
      const { AppKit }      = await import('@circle-fin/app-kit');
      const { ViemAdapter } = await import('@circle-fin/adapter-viem-v2');

      // Build adapter from connected wagmi wallet
      const adapter = new ViemAdapter({
        walletClient,
        publicClient,
      });

      const kit = new AppKit({
        kitKey: process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY,
      });

      console.log('[AppKit] ✅ Loaded with ViemAdapter');

      // ── 3. SWAP (skip if already USDC) ───────────────────────────────────
      if (token !== 'USDC') {
        await api.updateStep(id, { step: 'overall', status: 'swapping' });
        await api.updateStep(id, { step: 'swap',    status: 'pending'  });

        try {
          const result = await kit.swap({
            from:     { adapter, chain: appKitChain },
            tokenIn:  appKitToken,
            tokenOut: 'USDC',
            amount:   netAmount,
          });
          await api.updateStep(id, {
            step:   'swap',
            status: 'done',
            txHash: result?.txHash ?? result?.transactionHash ?? result?.hash,
          });
          console.log('[AppKit] ✅ Swap done', result);
        } catch (err: any) {
          await api.updateStep(id, { step: 'swap', status: 'failed', error: String(err) });
          throw new Error(`Swap failed: ${err.message}`);
        }
      } else {
        await api.updateStep(id, { step: 'swap', status: 'skipped' });
      }

      // ── 4. BRIDGE (skip if already on Arc) ─────────────────────────────────
      if (chain !== 'Arc_Testnet') {
        await api.updateStep(id, { step: 'overall', status: 'bridging' });
        await api.updateStep(id, { step: 'bridge',  status: 'pending'  });

        try {
          const result = await kit.bridge({
            from:   { adapter, chain: appKitChain },
            to:     { adapter, chain: 'Arc_Testnet' },
            token:  'USDC',
            amount: netAmount,
          });
          await api.updateStep(id, {
            step:   'bridge',
            status: 'done',
            txHash: result?.txHash ?? result?.transactionHash ?? result?.hash,
          });
          console.log('[AppKit] ✅ Bridge done', result);
        } catch (err: any) {
          await api.updateStep(id, { step: 'bridge', status: 'failed', error: String(err) });
          throw new Error(`Bridge failed: ${err.message}`);
        }
      } else {
        await api.updateStep(id, { step: 'bridge', status: 'skipped' });
      }

      // ── 5. SEND ────────────────────────────────────────────────────────────
      await api.updateStep(id, { step: 'overall', status: 'sending' });
      await api.updateStep(id, { step: 'send',    status: 'pending'  });

      try {
        const result = await kit.send({
          from:   { adapter, chain: 'Arc_Testnet' },
          to:     destination,
          token:  'USDC',
          amount: netAmount,
        });
        await api.updateStep(id, {
          step:   'send',
          status: 'done',
          txHash: result?.txHash ?? result?.transactionHash ?? result?.hash,
        });
        console.log('[AppKit] ✅ Send done', result);
      } catch (err: any) {
        await api.updateStep(id, { step: 'send', status: 'failed', error: String(err) });
        throw new Error(`Send failed: ${err.message}`);
      }

      await api.updateStep(id, { step: 'overall', status: 'completed' });

    } catch (err: any) {
      console.error('[AppKit] Error:', err);
      await api.updateStep(id, {
        step:   'overall',
        status: 'failed',
        error:  String(err),
      });
      throw err;
    }

    return id;
  }, [walletClient, publicClient]);

  return { route };
}
