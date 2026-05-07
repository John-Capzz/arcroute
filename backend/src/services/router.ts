/**
 * ArcRoute – Routing Engine
 * Fixed to pass correct field names to Circle App Kit SDK.
 */

import { v4 as uuid } from 'uuid';
import { getKit, adapters, SupportedChain, APP_KIT_TOKEN_SYMBOL } from '../lib/appkit';
import { txRepo } from '../db/database';

const FEE_PERCENT = parseFloat(process.env.FEE_PERCENT ?? '0.3');

export interface RouteParams {
  chain: SupportedChain;
  token: string;
  amount: string;
  destinationAddress: string;
}

export interface RouteResult {
  transactionId: string;
  estimatedOutput: string;
  feeAmount: string;
  feePercent: number;
}

export function calculateFee(amount: string): { net: string; fee: string } {
  const raw = parseFloat(amount);
  const fee = raw * (FEE_PERCENT / 100);
  const net = raw - fee;
  return { net: net.toFixed(6), fee: fee.toFixed(6) };
}

export async function routeTransaction(params: RouteParams): Promise<RouteResult> {
  const { chain, token, amount, destinationAddress } = params;

  if (!adapters[chain]) throw new Error(`Unsupported chain: ${chain}`);

  const supportedTokens = ['USDT', 'USDC', 'ETH', 'BNB'];
  if (!supportedTokens.includes(token.toUpperCase()))
    throw new Error(`Unsupported token: ${token}. Supported: ${supportedTokens.join(', ')}`);

  const { net: netAmount, fee } = calculateFee(amount);
  const id = uuid();

  txRepo.create({ id, chain, token: token.toUpperCase(), amount, destination: destinationAddress });

  runPipeline(id, chain, token.toUpperCase(), netAmount, destinationAddress).catch((err) => {
    console.error(`[Router] Pipeline failed for ${id}:`, err);
    txRepo.update(id, { status: 'failed', error: String(err) });
  });

  return { transactionId: id, estimatedOutput: netAmount, feeAmount: fee, feePercent: FEE_PERCENT };
}

async function runPipeline(
  id: string,
  chain: SupportedChain,
  token: string,
  amount: string,
  destination: string,
): Promise<void> {
  const kit           = await getKit();
  const sourceAdapter = adapters[chain];
  const arcAdapter    = adapters['Arc_Testnet'];
  let workingAmount   = amount;

  // ── Step 1: SWAP ─────────────────────────────────────────────────────────
  // Skip if token is already USDC
  if (token !== 'USDC') {
    txRepo.update(id, { status: 'swapping', step_swap: 'pending' });
    try {
      const result = await kit.swap({
        from:      { adapter: sourceAdapter, chain },
        tokenIn:   token,        // router maps to NATIVE/USDT etc internally
        tokenOut:  'USDC',
        amount:    workingAmount,
        slippageTolerance: 50,
      });
      workingAmount = result.outputAmount;
      txRepo.update(id, { step_swap: 'done', tx_hash: result.txHash });
      console.log(`[Router][${id}] ✅ swap done → ${workingAmount} USDC`);
    } catch (err) {
      txRepo.update(id, { status: 'failed', step_swap: 'failed', error: String(err) });
      throw err;
    }
  } else {
    txRepo.update(id, { step_swap: 'skipped' });
    console.log(`[Router][${id}] ⏭  swap skipped (already USDC)`);
  }

  // ── Step 2: BRIDGE ────────────────────────────────────────────────────────
  // Skip if already on Arc Testnet
  if (chain !== 'Arc_Testnet') {
    txRepo.update(id, { status: 'bridging', step_bridge: 'pending' });
    try {
      const result = await kit.bridge({
        from:   { adapter: sourceAdapter, chain },
        to:     { adapter: arcAdapter, chain: 'Arc_Testnet' },
        token:  'USDC',
        amount: workingAmount,
      });
      txRepo.update(id, { step_bridge: 'done', tx_hash: result.txHash });
      console.log(`[Router][${id}] ✅ bridge done`);
    } catch (err) {
      txRepo.update(id, { status: 'failed', step_bridge: 'failed', error: String(err) });
      throw err;
    }
  } else {
    txRepo.update(id, { step_bridge: 'skipped' });
    console.log(`[Router][${id}] ⏭  bridge skipped (already on Arc)`);
  }

  // ── Step 3: SEND ──────────────────────────────────────────────────────────
  txRepo.update(id, { status: 'sending', step_send: 'pending' });
  try {
    const result = await kit.send({
      from:   { adapter: arcAdapter, chain: 'Arc_Testnet' },
      to:     destination,
      token:  'USDC',
      amount: workingAmount,
    });
    txRepo.update(id, { step_send: 'done', status: 'completed', tx_hash: result.txHash });
    console.log(`[Router][${id}] ✅ send done — COMPLETED`);
  } catch (err) {
    txRepo.update(id, { status: 'failed', step_send: 'failed', error: String(err) });
    throw err;
  }
}
