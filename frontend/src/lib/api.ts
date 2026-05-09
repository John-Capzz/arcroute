const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://shimmering-cat-production-6fa9.up.railway.app';

export interface CreateTxRequest {
  chain: string;
  token: string;
  amount: string;
  destination: string;
}

export interface CreateTxResponse {
  transactionId: string;
  estimatedOutput: string;
  feeAmount: string;
  feePercent: number;
  outputToken: string;
  outputChain: string;
}

export interface StatusResponse {
  id: string;
  status: 'pending' | 'swapping' | 'bridging' | 'sending' | 'completed' | 'failed';
  steps: {
    swap:   'pending' | 'done' | 'skipped' | 'failed';
    bridge: 'pending' | 'done' | 'skipped' | 'failed';
    send:   'pending' | 'done' | 'skipped' | 'failed';
  };
  txHash:      string | null;
  chain:       string;
  token:       string;
  amount:      string;
  destination: string;
  error?:      string;
  createdAt:   string;
  updatedAt:   string;
}

export interface EstimateResponse {
  input:           string;
  token:           string;
  tokenPriceUSD:   number;
  usdValue:        string;
  fee:             string;
  feeUSD:          string;
  feePercent:      number;
  estimatedOutput: string;
  outputToken:     string;
  outputChain:     string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new Error('Cannot reach backend at localhost:3002. Is it running?');
  }

  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error('Backend returned HTML instead of JSON. Check terminal 1.');
  }

  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Invalid JSON from backend: ${text.slice(0, 80)}`); }

  if (!res.ok) throw new Error(data.error ?? `API error ${res.status}`);
  return data as T;
}

export const api = {
  // Create a tracking record — returns ID immediately
  performSwap: (body: {
    transactionId: string;
    chain: string;
    tokenIn: string;
    amount: string;
    kitKey: string;
  }) =>
    apiFetch<{ txHash: string; outputAmount: string }>('/swap', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createTransaction: (body: CreateTxRequest) =>
    apiFetch<CreateTxResponse>('/transaction', { method: 'POST', body: JSON.stringify(body) }),

  // Update a step's status as the frontend progresses
  updateStep: (id: string, body: {
    step: 'swap' | 'bridge' | 'send' | 'overall';
    status: string;
    txHash?: string;
    error?: string;
  }) =>
    apiFetch<{ success: boolean }>(`/transaction/${id}/step`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  status: (id: string) =>
    apiFetch<StatusResponse>(`/status/${id}`),

  estimate: (amount: string, token: string) =>
    apiFetch<EstimateResponse>(`/estimate?amount=${encodeURIComponent(amount)}&token=${encodeURIComponent(token)}`),
};
