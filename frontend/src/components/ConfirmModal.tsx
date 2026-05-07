'use client';

interface Props {
  open:        boolean;
  onConfirm:   () => void;
  onCancel:    () => void;
  chain:       string;
  token:       string;
  amount:      string;
  destination: string;
  feeAmount:   string;
  netAmount:   string;
  feePercent:  number;
  steps:       { label: string; desc: string }[];
}

export default function ConfirmModal({
  open, onConfirm, onCancel,
  chain, token, amount, destination,
  feeAmount, netAmount, feePercent, steps,
}: Props) {
  if (!open) return null;

  const chainLabel = chain.replace(/_/g, ' ');
  const short      = (addr: string) => `${addr.slice(0, 8)}…${addr.slice(-6)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />

      {/* Modal */}
      <div className="relative w-full max-w-md arc-surface arc-glow p-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-xl text-white">Confirm Transaction</h2>
          <button onClick={onCancel} className="text-muted hover:text-white transition-colors text-lg w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10">
            ✕
          </button>
        </div>

        {/* Amount summary */}
        <div className="bg-white/3 border border-white/8 rounded-xl p-4">
          <div className="text-xs font-mono text-muted uppercase tracking-widest mb-3">You are converting</div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-2xl font-display font-bold text-white">{amount} {token}</div>
              <div className="text-xs text-muted font-mono mt-0.5">{chainLabel}</div>
            </div>
            <div className="text-2xl text-arc-400">→</div>
            <div className="text-right">
              <div className="text-2xl font-display font-bold text-arc-300">{netAmount} USDC</div>
              <div className="text-xs text-muted font-mono mt-0.5">Arc Testnet</div>
            </div>
          </div>
        </div>

        {/* Fee breakdown */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-muted">
            <span>Input amount</span>
            <span className="font-mono">{amount} {token}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Protocol fee ({feePercent}%)</span>
            <span className="font-mono text-gold-400">− {feeAmount} {token}</span>
          </div>
          <div className="flex justify-between text-white font-bold border-t border-white/10 pt-2">
            <span>You receive</span>
            <span className="font-mono text-arc-300">
              {parseFloat(netAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDC
            </span>
          </div>
        </div>

        {/* Destination */}
        <div className="bg-white/3 border border-white/8 rounded-xl p-3">
          <div className="text-xs text-muted font-mono mb-1 uppercase tracking-widest">Destination wallet</div>
          <div className="font-mono text-xs text-arc-300 break-all">{destination}</div>
        </div>

        {/* Steps */}
        <div>
          <div className="text-xs font-mono text-muted uppercase tracking-widest mb-2">Steps that will execute</div>
          <div className="flex gap-2 flex-wrap">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-arc-500/10 border border-arc-500/30 rounded-lg px-3 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-arc-400 shrink-0" />
                <span className="text-xs font-mono text-arc-300 font-bold">{s.label}</span>
                <span className="text-xs text-muted">— {s.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Wallet notice */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-400 leading-relaxed">
          <span className="font-bold">⚡ Your wallet will open</span> to sign an approval.
          No funds move without your explicit signature. You stay in full control.
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            className="py-3.5 rounded-xl border border-white/15 text-muted hover:text-white hover:border-white/30 font-display font-bold text-sm transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="py-3.5 rounded-xl bg-gradient-to-r from-arc-600 to-arc-500 hover:from-arc-500 hover:to-arc-400 text-white font-display font-bold text-sm transition-all shadow-[0_4px_16px_rgba(84,97,245,0.4)] active:scale-[0.98]"
          >
            Sign & Convert →
          </button>
        </div>
      </div>
    </div>
  );
}
