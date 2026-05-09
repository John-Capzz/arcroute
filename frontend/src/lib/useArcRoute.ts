'use client';

import { useConnectorClient } from 'wagmi';
import { useCallback } from 'react';
import { api } from './api';

export interface RouteParams {
  chain:       string;
  token:       string;
  amount:      string;
  destination: string;
}

// Chain names for SWAP (short names)
const SWAP_CHAIN: Record<string, string> = {
  Ethereum_Sepolia: 'Ethereum',
  BNB_Testnet:      'BNB',
  Base_Sepolia:     'Base',
  Arc_Testnet:      'Arc_Testnet',
};

// Chain names for BRIDGE and SEND (full names)
const BRIDGE_CHAIN: Record<string, string> = {
  Ethereum_Sepolia: 'Ethereum_Sepolia',
  BNB_Testnet:      'BNB_Testnet',
  Base_Sepolia:     'Base_Sepolia',
  Arc_Testnet:      'Arc_Testnet',
};

const APP_KIT_TOKEN: Record<string, string> = {
  ETH:  'NATIVE',
  BNB:  'NATIVE',
  USDC: 'USDC',
  USDT: 'USDT',
};

export function useArcRoute() {
  const { data: connectorClient } = useConnectorClient();

  const route = useCallback(async (params: RouteParams): Promise<string> => {
    if (!connectorClient) throw new Error('Wallet not connected');

    const { chain, token, amount, destination } = params;
    const appKitSwapChain   = SWAP_CHAIN[chain];
    const appKitBridgeChain = BRIDGE_CHAIN[chain];
    const appKitToken       = APP_KIT_TOKEN[token] ?? token;

    if (!appKitSwapChain) throw new Error(`Unsupported chain: ${chain}`);

    // ── 1. Create backend tracking record ─────────────────────────────────────
    const tx        = await api.createTransaction({ chain, token, amount, destination });
    const id        = tx.transactionId;
    const netAmount = tx.estimatedOutput;

    try {
      // ── 2. Load Circle App Kit + viem adapter ─────────────────────────────
      const { AppKit }                    = await import('@circle-fin/app-kit');
      const { createAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2');

      // Extract EIP-1193 provider from wagmi connector
      const provider = (connectorClient as any)?.transport?.value?.provider
                    ?? (connectorClient as any)?.provider
                    ?? (window as any)?.ethereum;

      if (!provider) throw new Error('Could not get wallet provider from connector');

      // Create source chain adapter
      const sourceAdapter = await createAdapterFromProvider({ provider });

      // Create Arc Testnet adapter (same wallet, different chain context)
      const arcAdapter = await createAdapterFromProvider({ provider });

      // Initialize AppKit — no constructor args needed
      const kit = new AppKit();

      const kitKey = process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY ?? '';

      console.log('[AppKit] ✅ Initialized');

      // ── 3. SWAP (skip if already USDC) ────────────────────────────────────
      // NOTE: kit.swap() is server-side only (CORS blocked from browser)
      // For non-USDC tokens, we trigger swap via the backend
      if (token !== 'USDC') {
        await api.updateStep(id, { step: 'overall', status: 'swapping' });
        await api.updateStep(id, { step: 'swap',    status: 'pending'  });

        try {
          // Call backend to perform swap server-side
          const swapResult = await api.performSwap({
            transactionId: id,
            chain:         appKitSwapChain,
            tokenIn:       appKitToken,
            amount:        netAmount,
            kitKey:        'KIT_KEY:e7efa7add230055eb1f990975e39821b:499ccfc7a14cda7985bcedc42bf907e4',
          });
          await api.updateStep(id, {
            step:   'swap',
            status: 'done',
            txHash: swapResult?.txHash,
          });
          console.log('[AppKit] ✅ Swap done via backend', swapResult);
        } catch (err: any) {
          await api.updateStep(id, { step: 'swap', status: 'failed', error: String(err) });
          throw new Error(`Swap failed: ${err.message}`);
        }
      } else {
        await api.updateStep(id, { step: 'swap', status: 'skipped' });
      }

      // ── 4. BRIDGE (skip if already on Arc) ───────────────────────────────
      if (chain !== 'Arc_Testnet') {
        await api.updateStep(id, { step: 'overall', status: 'bridging' });
        await api.updateStep(id, { step: 'bridge',  status: 'pending'  });

        try {
          const result = await kit.bridge({
            from:   sourceAdapter,
            to:     { adapter: arcAdapter, chain: 'Arc_Testnet' },
            amount: netAmount,
            token:  'USDC',
          });
          await api.updateStep(id, {
            step:   'bridge',
            status: 'done',
            txHash: result?.hash ?? result?.txHash ?? result?.transactionHash,
          });
          console.log('[AppKit] ✅ Bridge done', result);
        } catch (err: any) {
          await api.updateStep(id, { step: 'bridge', status: 'failed', error: String(err) });
          throw new Error(`Bridge failed: ${err.message}`);
        }
      } else {
        await api.updateStep(id, { step: 'bridge', status: 'skipped' });
      }

      // ── 5. SEND ───────────────────────────────────────────────────────────
      await api.updateStep(id, { step: 'overall', status: 'sending' });
      await api.updateStep(id, { step: 'send',    status: 'pending'  });

      try {
        const result = await kit.send({
          from:   { adapter: arcAdapter, chain: 'Arc_Testnet' },
          to:     destination,
          amount: netAmount,
          token:  'USDC',
        });
        await api.updateStep(id, {
          step:   'send',
          status: 'done',
          txHash: result?.hash ?? result?.txHash ?? result?.transactionHash,
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
  }, [connectorClient]);

  return { route };
}
