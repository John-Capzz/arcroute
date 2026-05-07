'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  useAccount, useConnect, useDisconnect,
  useChainId, useSwitchChain, useBalance, useReadContract,
} from 'wagmi';
import { formatUnits } from 'viem';
import { api, EstimateResponse } from '@/lib/api';
import { useArcRoute } from '@/lib/useArcRoute';
import ConfirmModal from '@/components/ConfirmModal';

// ─── Token definitions per chain ─────────────────────────────────────────────
// native: true  = use wagmi useBalance (ETH / BNB)
// native: false = use ERC20 balanceOf
const CHAIN_TOKENS: Record<string, { id: string; label: string; color: string; native: boolean; address?: `0x${string}` }[]> = {
  Ethereum_Sepolia: [
    { id: 'ETH',  label: 'ETH',  color: '#627EEA', native: true },
    { id: 'USDC', label: 'USDC', color: '#2775ca', native: false, address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
    { id: 'USDT', label: 'USDT', color: '#26a17b', native: false, address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06' },
  ],
  BNB_Testnet: [
    { id: 'BNB',  label: 'BNB',  color: '#F3BA2F', native: true },
    { id: 'USDC', label: 'USDC', color: '#2775ca', native: false, address: '0x64544969ed7EBf5f083679233325356EbE738930' },
    { id: 'USDT', label: 'USDT', color: '#26a17b', native: false, address: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd' },
  ],
  Base_Sepolia: [
    { id: 'ETH',  label: 'ETH',  color: '#0052FF', native: true },
    { id: 'USDC', label: 'USDC', color: '#2775ca', native: false, address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
    { id: 'USDT', label: 'USDT', color: '#26a17b', native: false, address: '0x4D3D0e25b0E1E6B1E2D2A5A6B8b5E3e1E1e1e1e' },
  ],
};

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'decimals',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
] as const;

// ─── Chains ───────────────────────────────────────────────────────────────────
const CHAINS = [
  { id: 'Ethereum_Sepolia', label: 'Ethereum', sub: 'Sepolia', icon: '⟠', wagmiId: 11155111 },
  { id: 'BNB_Testnet',      label: 'BNB Chain', sub: 'Testnet', icon: '◈', wagmiId: 97 },
  { id: 'Base_Sepolia',     label: 'Base',      sub: 'Sepolia', icon: '⬡', wagmiId: 84532 },
];

const FAUCETS = [
  { label: 'Circle USDC Faucet',      url: 'https://faucet.circle.com',                     icon: '⟡', desc: 'Get USDC directly on testnet' },
  { label: 'Ethereum Sepolia Faucet', url: 'https://sepoliafaucet.com',                      icon: '⟠', desc: 'Get Sepolia ETH' },
  { label: 'BNB Testnet Faucet',      url: 'https://testnet.bnbchain.org/faucet-smart',      icon: '◈', desc: 'Get BNB on testnet' },
  { label: 'Base Sepolia Faucet',     url: 'https://bridge.base.org/deposit',                icon: '⬡', desc: 'Get Base Sepolia ETH' },
  { label: 'Alchemy Faucets',         url: 'https://www.alchemy.com/faucets',                icon: '◎', desc: 'Multi-chain testnet ETH' },
];

type Tab = 'convert' | 'faucet';

// ─── Route steps ──────────────────────────────────────────────────────────────
function getRouteSteps(token: string, sourceChain: string, sendToOther: boolean) {
  const needsSwap   = token !== 'USDC';
  const needsBridge = sourceChain !== 'Arc_Testnet';
  const needsSend   = sendToOther;
  const steps = [];
  if (needsSwap)   steps.push({ key: 'swap',   label: 'Swap',   desc: `${token} → USDC` });
  if (needsBridge) steps.push({ key: 'bridge', label: 'Bridge', desc: 'Source → Arc Testnet' });
  if (needsSend)   steps.push({ key: 'send',   label: 'Send',   desc: 'USDC → other wallet' });
  if (!needsSwap && !needsBridge && !needsSend)
    steps.push({ key: 'done', label: 'Ready', desc: 'Already USDC on Arc' });
  return steps;
}

// ─── Wallet Button ────────────────────────────────────────────────────────────
function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors }  = useConnect();
  const { disconnect }           = useDisconnect();
  const [showMenu, setShowMenu]  = useState(false);

  if (isConnected && address) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-arc-500/40 bg-arc-500/10 hover:bg-arc-500/20 transition-all text-sm font-mono"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          {address.slice(0, 6)}…{address.slice(-4)}
          <span className="text-muted text-xs">▾</span>
        </button>
        {showMenu && (
          <div className="absolute right-0 top-11 bg-[#13132a] border border-white/10 rounded-xl p-1 z-50 min-w-[140px]">
            <button
              onClick={() => { navigator.clipboard.writeText(address); setShowMenu(false); }}
              className="w-full text-left px-3 py-2 text-sm text-muted hover:bg-white/5 rounded-lg"
            >
              Copy address
            </button>
            <button
              onClick={() => { disconnect(); setShowMenu(false); }}
              className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-white/5 rounded-lg"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-arc-600 hover:bg-arc-500 transition-all text-sm font-display font-bold shadow-[0_2px_12px_rgba(84,97,245,0.4)]"
      >
        Connect Wallet
      </button>
      {showMenu && (
        <div className="absolute right-0 top-11 bg-[#13132a] border border-white/10 rounded-xl p-1 z-50 min-w-[180px]">
          {connectors.map((connector) => (
            <button
              key={connector.uid}
              onClick={() => { connect({ connector }); setShowMenu(false); }}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-white/5 rounded-lg flex items-center gap-2"
            >
              <span className="text-arc-400">◎</span>
              {connector.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Balance Hook ─────────────────────────────────────────────────────────────
function useTokenBalance(
  chain: string,
  token: string,
  address: `0x${string}` | undefined,
) {
  const tokenDef = CHAIN_TOKENS[chain]?.find(t => t.id === token);
  const isNative = tokenDef?.native ?? false;
  const chainDef = CHAINS.find(c => c.id === chain);

  // Native balance (ETH / BNB)
  const { data: nativeBal, isLoading: nativeLoading, refetch: refetchNative } = useBalance({
    address,
    chainId: chainDef?.wagmiId,
    query: { enabled: isNative && !!address },
  });

  // ERC20 balance
  const { data: erc20Raw, isLoading: erc20Loading, refetch: refetchERC20 } = useReadContract({
    address: tokenDef?.address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !isNative && !!address && !!tokenDef?.address },
  });

  const { data: decimalsRaw } = useReadContract({
    address: tokenDef?.address,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !isNative && !!tokenDef?.address },
  });

  const decimals = typeof decimalsRaw === 'number' ? decimalsRaw : 6;

  const balance = isNative
    ? (nativeBal ? parseFloat(nativeBal.formatted).toFixed(6) : null)
    : (erc20Raw !== undefined ? parseFloat(formatUnits(erc20Raw as bigint, decimals)).toFixed(4) : null);

  const isLoading = isNative ? nativeLoading : erc20Loading;
  const refetch   = isNative ? refetchNative  : refetchERC20;

  return { balance, isLoading, refetch };
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ConvertPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { switchChain }          = useSwitchChain();
  const connectedChainId         = useChainId();

  const [tab, setTab]               = useState<Tab>('convert');
  const [chain, setChain]           = useState('Ethereum_Sepolia');
  const [token, setToken]           = useState('ETH');
  const [amount, setAmount]         = useState('');
  const [sendToOther, setSendToOther] = useState(false);
  const [dest, setDest]             = useState('');
  const [estimate, setEstimate]     = useState<EstimateResponse | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [confirmed, setConfirmed]   = useState(false);
  const { route } = useArcRoute();
  const [showModal, setShowModal] = useState(false);

  // Available tokens for the selected chain
  const availableTokens = CHAIN_TOKENS[chain] ?? [];

  // Reset token to first option when chain changes
  const handleChainSelect = (chainId: string) => {
    setChain(chainId);
    setToken(CHAIN_TOKENS[chainId]?.[0]?.id ?? 'ETH');
    setAmount('');
    const wagmiChain = CHAINS.find(c => c.id === chainId);
    if (wagmiChain && isConnected) switchChain({ chainId: wagmiChain.wagmiId });
  };

  // Balance for selected token on selected chain
  const { balance: tokenBalance, isLoading: balanceLoading, refetch: refetchBalance } =
    useTokenBalance(chain, token, address);

  useEffect(() => { refetchBalance(); }, [chain, token, refetchBalance]);

  // Debounced fee estimate
  const fetchEstimate = useCallback(async (val: string) => {
    if (!val || isNaN(parseFloat(val)) || parseFloat(val) <= 0) { setEstimate(null); return; }
    try { setEstimate(await api.estimate(val, token)); } catch { setEstimate(null); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchEstimate(amount), 400);
    return () => clearTimeout(t);
  }, [amount, fetchEstimate]);

  const routeSteps    = getRouteSteps(token, chain, sendToOther);
  const selectedChain = CHAINS.find(c => c.id === chain);
  const selectedToken = availableTokens.find(t => t.id === token);

  const exceedsBalance = !!(tokenBalance && amount && parseFloat(amount) > parseFloat(tokenBalance));
  const balancePct     = tokenBalance && amount && parseFloat(tokenBalance) > 0
    ? Math.min((parseFloat(amount) / parseFloat(tokenBalance)) * 100, 100)
    : 0;

  const handleSubmit = async () => {
    setError('');
    if (!isConnected)                        { setError('Please connect your wallet first.'); return; }
    if (!amount || parseFloat(amount) <= 0)  { setError('Please enter a valid amount.'); return; }
    if (exceedsBalance)                      { setError('Amount exceeds your balance.'); return; }
    if (sendToOther && !/^0x[0-9a-fA-F]{40}$/.test(dest))
      { setError('Please enter a valid destination address.'); return; }
    if (!confirmed) { setError('Please confirm the transaction details.'); return; }
    // Show confirmation modal first
    setShowModal(true);
  };

  const handleConfirmed = async () => {
    setShowModal(false);
    setLoading(true);
    try {
      const destination = sendToOther ? dest : (address as string);
      const txId = await route({ chain, token, amount, destination });
      router.push(`/status/${txId}`);
    } catch (err: any) {
      setError(err.message ?? 'Conversion failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="mesh-bg min-h-screen flex flex-col">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-arc-600 flex items-center justify-center arc-glow">
            <span className="text-sm font-display font-bold">⟡</span>
          </div>
          <span className="font-display font-bold text-lg tracking-tight">ArcRoute</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-muted font-mono">Testnet</span>
          </div>
          <WalletButton />
        </div>
      </header>

      {/* ── Tabs ────────────────────────────────────────────────────── */}
      <div className="flex justify-center pt-6 px-4">
        <div className="flex gap-1 bg-white/5 rounded-xl p-1 border border-white/8">
          <button
            onClick={() => setTab('convert')}
            className={`px-5 py-2 rounded-lg text-sm font-display font-bold transition-all duration-200 ${
              tab === 'convert' ? 'bg-arc-600 text-white shadow-[0_2px_8px_rgba(84,97,245,0.4)]' : 'text-muted hover:text-white'
            }`}
          >
            ⇄ Convert
          </button>
          <button
            onClick={() => setTab('faucet')}
            className={`px-5 py-2 rounded-lg text-sm font-display font-bold transition-all duration-200 ${
              tab === 'faucet' ? 'bg-arc-600 text-white shadow-[0_2px_8px_rgba(84,97,245,0.4)]' : 'text-muted hover:text-white'
            }`}
          >
            🚰 Faucets
          </button>
        </div>
      </div>

      {/* ── Main ────────────────────────────────────────────────────── */}
      <main className="flex-1 flex items-start justify-center py-6 px-4">
        <div className="w-full max-w-lg">

          {/* ═══ FAUCET TAB ═══════════════════════════════════════════ */}
          {tab === 'faucet' && (
            <div className="space-y-4">
              <div className="text-center mb-6">
                <h2 className="font-display font-bold text-2xl text-white mb-1">Testnet Faucets</h2>
                <p className="text-muted text-sm">Get free testnet tokens to try ArcRoute</p>
              </div>

              {isConnected && address && (
                <div className="arc-surface p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-muted mb-1 font-mono uppercase tracking-widest">Your wallet</div>
                    <div className="font-mono text-sm text-arc-300 truncate">{address}</div>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(address)}
                    className="text-xs text-muted hover:text-white border border-white/10 hover:border-white/25 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                  >
                    Copy
                  </button>
                </div>
              )}
              {!isConnected && (
                <div className="bg-arc-500/10 border border-arc-500/30 rounded-xl p-4 text-sm text-arc-300 text-center">
                  Connect your wallet to copy your address for faucet requests
                </div>
              )}

              <div className="arc-surface p-2 space-y-1">
                {FAUCETS.map((faucet) => (
                  <a key={faucet.url} href={faucet.url} target="_blank" rel="noreferrer"
                    className="flex items-center justify-between p-4 rounded-xl hover:bg-white/5 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl w-8 text-center">{faucet.icon}</span>
                      <div>
                        <div className="text-sm font-display font-bold group-hover:text-arc-300 transition-colors">
                          {faucet.label}
                        </div>
                        <div className="text-xs text-muted">{faucet.desc}</div>
                      </div>
                    </div>
                    <span className="text-muted text-xs group-hover:text-arc-400 transition-colors shrink-0">Open ↗</span>
                  </a>
                ))}
              </div>

              <div className="bg-white/3 border border-white/5 rounded-xl p-4 text-xs text-muted leading-relaxed">
                <span className="text-gold-400 font-bold">Tip:</span> The easiest path is to get ETH or BNB from a faucet first, then come back and convert it to USDC on Arc directly — no need to hunt for USDC faucets.
              </div>
            </div>
          )}

          {/* ═══ CONVERT TAB ══════════════════════════════════════════ */}
          {tab === 'convert' && (
            <>
              <div className="mb-5 text-center">
                <h1 className="font-display font-bold text-3xl gradient-text mb-1">
                  Convert to Arc USDC
                </h1>
                <p className="text-muted text-sm">
                  Native tokens, USDC or USDT — ArcRoute handles the path.
                </p>
              </div>

              {!isConnected && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-sm text-amber-400 text-center mb-4">
                  Connect your wallet to get started
                </div>
              )}

              <div className="arc-surface arc-glow p-5 space-y-5">

                {/* ── Chain selector ─────────────────────────────────── */}
                <div>
                  <label className="block text-xs font-mono text-muted mb-2 uppercase tracking-widest">
                    Source Chain
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {CHAINS.map((c) => {
                      const isWrongChain = isConnected && connectedChainId !== c.wagmiId && chain === c.id;
                      return (
                        <button
                          key={c.id}
                          onClick={() => handleChainSelect(c.id)}
                          className={`flex flex-col items-center py-3 px-2 rounded-xl border text-center transition-all duration-200 relative ${
                            chain === c.id
                              ? 'border-arc-500 bg-arc-500/15 text-white'
                              : 'border-white/10 bg-white/3 text-muted hover:border-white/25'
                          }`}
                        >
                          <span className="text-xl mb-1">{c.icon}</span>
                          <span className="text-xs font-display font-bold">{c.label}</span>
                          <span className="text-[10px] text-muted">{c.sub}</span>
                          {isWrongChain && (
                            <span className="absolute -top-1.5 -right-1.5 text-[9px] bg-amber-500 text-black font-bold px-1.5 py-0.5 rounded-full">
                              Switch
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Token selector — dynamic per chain ─────────────── */}
                <div>
                  <label className="block text-xs font-mono text-muted mb-2 uppercase tracking-widest">
                    Token to Convert
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {availableTokens.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => { setToken(t.id); setAmount(''); }}
                        className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all duration-200 ${
                          token === t.id
                            ? 'border-arc-500 bg-arc-500/15 text-white'
                            : 'border-white/10 bg-white/3 text-muted hover:border-white/25'
                        }`}
                      >
                        {/* Token colour dot */}
                        <span
                          className="w-5 h-5 rounded-full border-2 border-white/20"
                          style={{ background: t.color }}
                        />
                        <span className="font-mono font-bold text-sm">{t.label}</span>
                        {/* Show "Native" badge */}
                        {t.native && (
                          <span className="text-[9px] font-mono uppercase tracking-wider text-gold-400">
                            Native
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Amount + Balance ────────────────────────────────── */}
                <div>
                  {/* Label row with live balance */}
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-mono text-muted uppercase tracking-widest">
                      Amount
                    </label>
                    {isConnected && (
                      <div className="flex items-center gap-2">
                        {balanceLoading ? (
                          <span className="text-xs font-mono text-muted animate-pulse">
                            Fetching balance…
                          </span>
                        ) : tokenBalance !== null ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-muted">
                              Balance:{' '}
                              <span className="text-white font-bold">{tokenBalance}</span>
                              {' '}<span style={{ color: selectedToken?.color }}>{token}</span>
                            </span>
                            <button
                              onClick={() => setAmount(tokenBalance)}
                              className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg bg-arc-500/20 border border-arc-500/40 text-arc-300 hover:bg-arc-500/35 hover:text-white transition-all"
                            >
                              MAX
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs font-mono text-muted">
                            No {token} on this chain
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Input */}
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className={`w-full bg-white/5 border rounded-xl px-4 py-3.5 text-white font-mono text-lg placeholder:text-muted focus:outline-none transition-colors pr-20 ${
                        exceedsBalance
                          ? 'border-red-500/60 focus:border-red-500'
                          : 'border-white/10 focus:border-arc-500'
                      }`}
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: selectedToken?.color }}
                      />
                      <span className="text-sm font-mono text-muted">{token}</span>
                    </div>
                  </div>

                  {/* Balance progress bar */}
                  {tokenBalance && parseFloat(tokenBalance) > 0 && amount && parseFloat(amount) > 0 && (
                    <div className="mt-2.5">
                      <div className="h-1.5 w-full bg-white/8 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${balancePct}%`,
                            background: exceedsBalance
                              ? '#f87171'
                              : `linear-gradient(90deg, ${selectedToken?.color ?? '#5461f5'}, #7589ff)`,
                          }}
                        />
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-muted font-mono">0</span>
                        {exceedsBalance ? (
                          <span className="text-[10px] text-red-400 font-mono font-bold">
                            ⚠ Exceeds balance
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted font-mono">
                            {balancePct.toFixed(1)}% of balance
                          </span>
                        )}
                        <span className="text-[10px] text-muted font-mono">{tokenBalance}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Destination toggle ──────────────────────────────── */}
                <div>
                  <label className="block text-xs font-mono text-muted mb-2 uppercase tracking-widest">
                    Destination
                  </label>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <button
                      onClick={() => setSendToOther(false)}
                      className={`py-2.5 rounded-xl border text-sm font-display font-bold transition-all ${
                        !sendToOther ? 'border-arc-500 bg-arc-500/15 text-white' : 'border-white/10 bg-white/3 text-muted hover:border-white/25'
                      }`}
                    >
                      My Wallet
                    </button>
                    <button
                      onClick={() => setSendToOther(true)}
                      className={`py-2.5 rounded-xl border text-sm font-display font-bold transition-all ${
                        sendToOther ? 'border-arc-500 bg-arc-500/15 text-white' : 'border-white/10 bg-white/3 text-muted hover:border-white/25'
                      }`}
                    >
                      Other Wallet
                    </button>
                  </div>

                  {!sendToOther && isConnected && address && (
                    <div className="flex items-center gap-2 bg-white/3 border border-white/8 rounded-xl px-4 py-3">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      <span className="font-mono text-xs text-arc-300 truncate">{address}</span>
                    </div>
                  )}
                  {sendToOther && (
                    <input
                      type="text"
                      placeholder="0x… destination wallet address"
                      value={dest}
                      onChange={(e) => setDest(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white font-mono text-sm placeholder:text-muted focus:outline-none focus:border-arc-500 transition-colors"
                    />
                  )}
                </div>

                {/* ── Route preview ───────────────────────────────────── */}
                <div className="bg-white/3 rounded-xl border border-white/5 p-4">
                  <div className="text-xs font-mono text-muted uppercase tracking-widest mb-3">
                    Route Preview
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {/* Source */}
                    <div className="flex flex-col items-center px-2">
                      <div
                        className="w-9 h-9 rounded-full border-2 flex items-center justify-center mb-1"
                        style={{ borderColor: (selectedToken?.color ?? '#5461f5') + '55', background: (selectedToken?.color ?? '#5461f5') + '18' }}
                      >
                        <span className="text-xs font-bold" style={{ color: selectedToken?.color }}>{token.slice(0,3)}</span>
                      </div>
                      <span className="text-[10px] font-mono text-white">{token}</span>
                      <span className="text-[9px] text-muted">{selectedChain?.label}</span>
                    </div>

                    {/* Steps */}
                    {routeSteps.map((step, i) => (
                      <div key={step.key} className="flex items-center gap-1">
                        <div className="flex flex-col items-center px-1">
                          <svg width="28" height="12" viewBox="0 0 28 12" className="mb-3">
                            <line x1="0" y1="6" x2="23" y2="6" stroke="rgba(84,97,245,0.6)" strokeWidth="1.5" strokeDasharray="3 2" className="flow-arrow"/>
                            <polygon points="23,3 28,6 23,9" fill="rgba(84,97,245,0.9)"/>
                          </svg>
                          <span className="text-[9px] font-mono text-arc-400 uppercase">{step.label}</span>
                        </div>
                        {i === routeSteps.length - 1 && (
                          <div className="flex flex-col items-center px-2">
                            <div className="w-9 h-9 rounded-full bg-arc-500/20 border-2 border-arc-500/40 flex items-center justify-center mb-1">
                              <span className="text-xs">⟡</span>
                            </div>
                            <span className="text-[10px] font-mono text-white">USDC</span>
                            <span className="text-[9px] text-muted">Arc Net</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Fee estimate ────────────────────────────────────── */}
                {estimate && (
                  <div className="bg-white/3 rounded-xl border border-white/5 p-4 space-y-2">
                    {/* Show price for native tokens */}
                    {estimate.tokenPriceUSD > 1 && (
                      <div className="flex justify-between text-sm pb-2 border-b border-white/8">
                        <span className="text-muted">1 {token} price</span>
                        <span className="font-mono text-white">${estimate.tokenPriceUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">USD value</span>
                      <span className="font-mono text-white">${parseFloat(estimate.usdValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Protocol fee ({estimate.feePercent}%)</span>
                      <span className="font-mono text-gold-400">− ${parseFloat(estimate.feeUSD).toFixed(4)}</span>
                    </div>
                    <div className="border-t border-white/8 pt-2 flex justify-between">
                      <span className="text-sm font-bold text-white">You receive</span>
                      <span className="font-mono font-bold text-arc-300">{parseFloat(estimate.estimatedOutput).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDC</span>
                    </div>
                  </div>
                )}

                {/* ── Confirm checkbox ────────────────────────────────── */}
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-arc-500 rounded shrink-0"
                  />
                  <span className="text-xs text-muted leading-relaxed">
                    I confirm this is a testnet transaction. ArcRoute is non-custodial — I retain control of my keys.
                  </span>
                </label>

                {/* ── Error ───────────────────────────────────────────── */}
                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-400">
                    {error}
                  </div>
                )}

                {/* ── Submit ──────────────────────────────────────────── */}
                <button
                  onClick={handleSubmit}
                  disabled={loading || !amount || exceedsBalance || (!sendToOther && !isConnected)}
                  className="w-full py-4 rounded-xl font-display font-bold text-base transition-all duration-200
                    bg-gradient-to-r from-arc-600 to-arc-500 hover:from-arc-500 hover:to-arc-400
                    disabled:opacity-40 disabled:cursor-not-allowed
                    shadow-[0_4px_24px_rgba(84,97,245,0.35)] hover:shadow-[0_4px_32px_rgba(84,97,245,0.5)]
                    active:scale-[0.98]"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Initiating…
                    </span>
                  ) : !isConnected
                    ? 'Connect Wallet to Continue'
                    : `Convert ${token} to Arc USDC →`
                  }
                </button>
              </div>

              <p className="text-center text-xs text-muted mt-4">
                Powered by{' '}
                <a href="https://developers.circle.com/w3s/circle-app-kit" target="_blank" rel="noreferrer"
                  className="text-arc-400 hover:text-arc-300 underline underline-offset-2">
                  Circle App Kit
                </a>
                {' '}· EVM testnets only · 0.3% fee
              </p>
            </>
          )}
        </div>
      </main>

      {/* ── Confirmation modal ─────────────────────────────────────── */}
      <ConfirmModal
        open={showModal}
        onCancel={() => setShowModal(false)}
        onConfirm={handleConfirmed}
        chain={chain}
        token={token}
        amount={amount}
        destination={sendToOther ? dest : (address ?? '')}
        feeAmount={estimate?.fee ?? '0'}
        netAmount={estimate?.estimatedOutput ?? amount}
        feePercent={estimate?.feePercent ?? 0.3}
        steps={routeSteps.map(s => ({ label: s.label, desc: s.desc }))}
      />
    </div>
  );
}
