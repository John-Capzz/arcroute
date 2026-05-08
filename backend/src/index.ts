import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { txRepo } from './db/database';
import { v4 as uuid } from 'uuid';

const app  = express();
const PORT = parseInt(process.env.PORT ?? '3002', 10);
const FEE  = parseFloat(process.env.FEE_PERCENT ?? '0.3');

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.options('*', cors());
app.use(express.json());

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', service: 'ArcRoute API', port: PORT });
});

// ── Price cache (avoid hammering CoinGecko) ───────────────────────────────────
const priceCache: Record<string, { price: number; fetchedAt: number }> = {};
const CACHE_TTL_MS = 30_000; // 30 seconds

// CoinGecko IDs for each token
const COINGECKO_IDS: Record<string, string> = {
  ETH:  'ethereum',
  BNB:  'binancecoin',
  USDC: 'usd-coin',
  USDT: 'tether',
};

async function getUSDPrice(token: string): Promise<number> {
  // Stablecoins are always $1
  if (token === 'USDC' || token === 'USDT') return 1;

  const cached = priceCache[token];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  const geckoId = COINGECKO_IDS[token];
  if (!geckoId) return 1;

  try {
    const res  = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd`,
      { headers: { 'Accept': 'application/json' } }
    );
    const data = await res.json() as Record<string, { usd: number }>;
    const price = data[geckoId]?.usd ?? 1;
    priceCache[token] = { price, fetchedAt: Date.now() };
    console.log(`[Price] ${token} = $${price}`);
    return price;
  } catch (err) {
    console.error(`[Price] Failed to fetch ${token} price:`, err);
    // Fall back to cached price if available, else return 1
    return priceCache[token]?.price ?? 1;
  }
}

// ── Estimate ──────────────────────────────────────────────────────────────────
app.get('/estimate', async (req: Request, res: Response) => {
  const amount = parseFloat(req.query.amount as string);
  const token  = ((req.query.token as string) ?? 'USDC').toUpperCase();

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  // Get live USD price for the input token
  const usdPrice    = await getUSDPrice(token);

  // Convert to USDC value then deduct fee
  const usdValue    = amount * usdPrice;
  const feeUSD      = usdValue * (FEE / 100);
  const netUSD      = usdValue - feeUSD;

  // Fee expressed in input token terms (for display)
  const feeInToken  = amount * (FEE / 100);

  return res.json({
    input:           amount.toFixed(6),
    token,
    tokenPriceUSD:   usdPrice,
    usdValue:        usdValue.toFixed(2),
    fee:             feeInToken.toFixed(6),
    feeUSD:          feeUSD.toFixed(4),
    feePercent:      FEE,
    estimatedOutput: netUSD.toFixed(4),   // in USDC
    outputToken:     'USDC',
    outputChain:     'Arc_Testnet',
  });
});

// ── POST /transaction — create a new transaction record ───────────────────────
// Frontend calls this FIRST to get a tracking ID, then does the chain calls itself
app.post('/transaction', (req: Request, res: Response) => {
  const { chain, token, amount, destination } = req.body;

  const errors: string[] = [];
  if (!chain)       errors.push('chain is required');
  if (!token)       errors.push('token is required');
  if (!amount)      errors.push('amount is required');
  if (!destination) errors.push('destination is required');
  else if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) errors.push('destination must be a valid 0x address');

  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  const id  = uuid();
  const fee = parseFloat(amount) * (FEE / 100);
  const net = (parseFloat(amount) - fee).toFixed(6);

  txRepo.create({ id, chain, token: token.toUpperCase(), amount, destination });

  return res.status(201).json({
    transactionId:   id,
    estimatedOutput: net,
    feeAmount:       fee.toFixed(6),
    feePercent:      FEE,
    outputToken:     'USDC',
    outputChain:     'Arc_Testnet',
  });
});

// ── PATCH /transaction/:id/step — frontend updates step status as it progresses
app.patch('/transaction/:id/step', (req: Request, res: Response) => {
  const tx = txRepo.findById(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  const { step, status, txHash, error } = req.body;
  // step: 'swap' | 'bridge' | 'send' | 'overall'
  // status: 'done' | 'skipped' | 'failed' | 'swapping' | 'bridging' | 'sending' | 'completed'

  const patch: any = {};
  if (step === 'swap')    patch.step_swap   = status;
  if (step === 'bridge')  patch.step_bridge = status;
  if (step === 'send')    patch.step_send   = status;
  if (step === 'overall') patch.status      = status;
  if (txHash) patch.tx_hash = txHash;
  if (error)  patch.error   = error;

  // Auto-set overall status based on step
  if (step === 'swap'   && status === 'done') patch.status = 'bridging';
  if (step === 'bridge' && status === 'done') patch.status = 'sending';
  if (step === 'send'   && status === 'done') patch.status = 'completed';
  if (status === 'failed') patch.status = 'failed';

  txRepo.update(req.params.id, patch);
  return res.json({ success: true, id: req.params.id });
});

// ── GET /status/:id ───────────────────────────────────────────────────────────
app.get('/status/:id', (req: Request, res: Response) => {
  const tx = txRepo.findById(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  return res.json({
    id:          tx.id,
    status:      tx.status,
    steps: {
      swap:   tx.step_swap,
      bridge: tx.step_bridge,
      send:   tx.step_send,
    },
    txHash:      tx.tx_hash,
    chain:       tx.chain,
    token:       tx.token,
    amount:      tx.amount,
    destination: tx.destination,
    error:       tx.error ?? undefined,
    createdAt:   tx.created_at,
    updatedAt:   tx.updated_at,
  });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 ArcRoute API listening on http://localhost:${PORT}`);
  console.log(`   POST  /transaction         – Create tx record`);
  console.log(`   PATCH /transaction/:id/step – Update step status`);
  console.log(`   GET   /status/:id           – Poll status`);
  console.log(`   GET   /estimate             – Fee estimate\n`);
});

export default app;
