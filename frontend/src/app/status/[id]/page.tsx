'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, StatusResponse } from '@/lib/api';

type StepState = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

interface Step {
  key: 'swap' | 'bridge' | 'send';
  label: string;
  description: string;
  icon: string;
}

const STEPS: Step[] = [
  { key: 'swap',   label: 'Swap',   description: 'Converting token to USDC on source chain', icon: '⇄' },
  { key: 'bridge', label: 'Bridge', description: 'Moving USDC to Arc Testnet',               icon: '⟺' },
  { key: 'send',   label: 'Send',   description: 'Delivering USDC to destination wallet',    icon: '→' },
];

const STATUS_MESSAGES: Record<string, string> = {
  pending:   'Transaction queued, preparing…',
  swapping:  'Swapping your token to USDC…',
  bridging:  'Bridging USDC to Arc Testnet…',
  sending:   'Sending USDC to your wallet…',
  completed: 'Conversion complete! 🎉',
  failed:    'Transaction failed.',
};

function StepRow({ step, state }: { step: Step; state: StepState }) {
  const colors: Record<StepState, string> = {
    pending: 'border-white/10 bg-white/3 text-muted',
    active:  'border-arc-500 bg-arc-500/15 text-white shadow-[0_0_12px_rgba(84,97,245,0.3)]',
    done:    'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
    skipped: 'border-white/10 bg-white/3 text-muted',
    failed:  'border-red-500/50 bg-red-500/10 text-red-400',
  };

  const icons: Record<StepState, string> = {
    pending: '○',
    active:  '◌',
    done:    '✓',
    skipped: '—',
    failed:  '✗',
  };

  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-500 ${colors[state]}`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center border shrink-0
        ${state === 'active' ? 'border-arc-400' : 'border-current/30'}`}>
        {state === 'active' ? (
          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l4-4-4-4v4A10 10 0 1014 22H12a8 8 0 01-8-8z"/>
          </svg>
        ) : (
          <span className="text-sm font-mono">{icons[state]}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-sm">{step.label}</span>
          {state === 'skipped' && (
            <span className="text-[10px] font-mono bg-white/5 px-2 py-0.5 rounded-full">skipped</span>
          )}
        </div>
        <span className="text-xs text-muted block truncate">{step.description}</span>
      </div>
      <span className="text-xl opacity-60 shrink-0">{step.icon}</span>
    </div>
  );
}

// ─── Page receives params as a prop in Next.js App Router ────────────────────
export default function StatusPage({ params }: { params: { id: string } }) {
  const router   = useRouter();
  const id       = params.id;

  const [tx, setTx]           = useState<StatusResponse | null>(null);
  const [error, setError]     = useState('');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await api.status(id);
        if (!cancelled) setTx(data);
        if (data.status === 'completed' || data.status === 'failed') return;
        setTimeout(poll, 2000);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'Failed to fetch status');
      }
    };

    poll();
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [id]);

  function getStepState(step: Step): StepState {
    if (!tx) return 'pending';
    const raw = tx.steps[step.key];
    if (raw === 'done')    return 'done';
    if (raw === 'skipped') return 'skipped';
    if (raw === 'failed')  return 'failed';
    const activeMap: Record<string, string> = {
      swapping: 'swap',
      bridging: 'bridge',
      sending:  'send',
    };
    if (activeMap[tx.status] === step.key) return 'active';
    return 'pending';
  }

  const isTerminal  = tx?.status === 'completed' || tx?.status === 'failed';
  const isCompleted = tx?.status === 'completed';
  const isFailed    = tx?.status === 'failed';

  return (
    <div className="mesh-bg min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/5">
        <button
          onClick={() => router.push('/convert')}
          className="flex items-center gap-2 text-muted hover:text-white transition-colors group"
        >
          <span className="group-hover:-translate-x-0.5 transition-transform">←</span>
          <span className="text-sm">New conversion</span>
        </button>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            isCompleted ? 'bg-emerald-400' : isFailed ? 'bg-red-400' : 'bg-arc-400 animate-pulse'
          }`}/>
          <span className="text-xs text-muted font-mono capitalize">{tx?.status ?? 'loading'}</span>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center py-12 px-4">
        <div className="w-full max-w-lg space-y-5">

          {/* Title */}
          <div className="text-center mb-2">
            <h1 className="font-display font-bold text-3xl mb-2">
              {isCompleted ? (
                <span className="gradient-text">Conversion Complete!</span>
              ) : isFailed ? (
                <span className="text-red-400">Transaction Failed</span>
              ) : (
                <span className="text-white">Processing…</span>
              )}
            </h1>
            <p className="text-muted text-sm font-mono">
              {STATUS_MESSAGES[tx?.status ?? 'pending']}
            </p>
            {!isTerminal && (
              <p className="text-muted text-xs mt-1 font-mono">
                Elapsed: {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
              </p>
            )}
          </div>

          {/* Transaction summary */}
          {tx && (
            <div className="arc-surface p-5 space-y-3">
              <div className="text-xs font-mono text-muted uppercase tracking-widest mb-3">
                Transaction Details
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted text-xs mb-0.5">Amount</div>
                  <div className="font-mono font-bold">{tx.amount} {tx.token}</div>
                </div>
                <div>
                  <div className="text-muted text-xs mb-0.5">Source Chain</div>
                  <div className="font-mono">{tx.chain.replace('_', ' ')}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted text-xs mb-0.5">Destination</div>
                  <div className="font-mono text-xs text-arc-300 truncate">{tx.destination}</div>
                </div>
              </div>
              <div className="text-xs font-mono text-muted pt-2 border-t border-white/5 truncate">
                ID: {tx.id}
              </div>
            </div>
          )}

          {/* Steps */}
          <div className="arc-surface p-5 space-y-3">
            <div className="text-xs font-mono text-muted uppercase tracking-widest mb-1">
              Routing Steps
            </div>
            {STEPS.map((step) => (
              <StepRow key={step.key} step={step} state={getStepState(step)} />
            ))}
          </div>

          {/* Tx Hash */}
          {tx?.txHash && (
            <div className="bg-white/3 border border-white/8 rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted mb-1 font-mono uppercase tracking-widest">
                  Latest tx hash
                </div>
                <span className="font-mono text-sm text-arc-300 truncate block">
                  {tx.txHash.slice(0, 10)}…{tx.txHash.slice(-8)}
                </span>
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(tx.txHash!)}
                className="text-xs text-muted hover:text-white border border-white/10 hover:border-white/25 px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                Copy
              </button>
            </div>
          )}

          {/* Error */}
          {(error || tx?.error) && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
              <div className="font-bold mb-1">Error</div>
              {error || tx?.error}
            </div>
          )}

          {/* Completion CTA */}
          {isCompleted && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5 text-center">
              <div className="text-4xl mb-3">🎉</div>
              <div className="font-display font-bold text-emerald-400 text-lg mb-1">
                USDC delivered to Arc Testnet
              </div>
              <p className="text-xs text-muted mb-4">
                Your funds have been converted and sent to the destination wallet.
              </p>
              <button
                onClick={() => router.push('/convert')}
                className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-display font-bold transition-colors text-sm"
              >
                Convert Again
              </button>
            </div>
          )}

          {isFailed && (
            <div className="text-center">
              <button
                onClick={() => router.push('/convert')}
                className="px-6 py-3 rounded-xl bg-arc-600 hover:bg-arc-500 text-white font-display font-bold transition-colors text-sm"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Polling indicator */}
          {!isTerminal && !error && (
            <p className="text-center text-xs text-muted">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-arc-400 animate-pulse mr-2 align-middle"/>
              Polling every 2 seconds
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
