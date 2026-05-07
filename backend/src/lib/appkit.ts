/**
 * ArcRoute – Circle App Kit Configuration
 * Chain names updated to match App Kit supported values exactly.
 */

import { createPublicClient, createWalletClient, http, custom } from 'viem';
import { sepolia, bscTestnet, baseSepolia } from 'viem/chains';

// ─── Custom Arc Testnet chain ─────────────────────────────────────────────────
const arcTestnet = {
  id: 1516651,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'ARC', symbol: 'ARC', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ARC_TESTNET_RPC ?? 'https://rpc.arc-testnet.circle.com'] },
    public:  { http: [process.env.ARC_TESTNET_RPC ?? 'https://rpc.arc-testnet.circle.com'] },
  },
  testnet: true,
} as const;

// ─── App Kit chain names (MUST match SDK exactly) ─────────────────────────────
// These are the values Circle App Kit accepts — NOT the RPC chain names
export const APP_KIT_CHAIN_NAMES: Record<string, string> = {
  Ethereum_Sepolia: 'Ethereum',    // App Kit uses "Ethereum" for Sepolia too
  BNB_Testnet:      'BNB',         // App Kit uses "BNB"
  Base_Sepolia:     'Base',        // App Kit uses "Base"
  Arc_Testnet:      'Arc_Testnet', // App Kit uses "Arc_Testnet"
};

// ─── Token symbol mapping ─────────────────────────────────────────────────────
// Native tokens must be sent as "NATIVE" to App Kit
export const APP_KIT_TOKEN_SYMBOL: Record<string, string> = {
  ETH:  'NATIVE',
  BNB:  'NATIVE',
  USDC: 'USDC',
  USDT: 'USDT',
};

// ─── RPC URLs ─────────────────────────────────────────────────────────────────
const RPC = {
  Ethereum_Sepolia: process.env.ETH_SEPOLIA_RPC  ?? 'https://ethereum-sepolia-rpc.publicnode.com',
  BNB_Testnet:      process.env.BNB_TESTNET_RPC  ?? 'https://bsc-testnet-rpc.publicnode.com',
  Base_Sepolia:     process.env.BASE_SEPOLIA_RPC ?? 'https://base-sepolia-rpc.publicnode.com',
  Arc_Testnet:      process.env.ARC_TESTNET_RPC  ?? 'https://rpc.arc-testnet.circle.com',
} as const;

export type SupportedChain = keyof typeof RPC;

// ─── Viem chain objects ───────────────────────────────────────────────────────
export const viemChains: Record<SupportedChain, any> = {
  Ethereum_Sepolia: sepolia,
  BNB_Testnet:      bscTestnet,
  Base_Sepolia:     baseSepolia,
  Arc_Testnet:      arcTestnet,
};

// ─── EVM Adapter ─────────────────────────────────────────────────────────────
export interface EVMAdapter {
  chainName: SupportedChain;
  appKitChainName: string;   // The name App Kit expects
  publicClient: ReturnType<typeof createPublicClient>;
  getWalletClient: (account: `0x${string}`, provider?: any) => ReturnType<typeof createWalletClient>;
}

function createEVMAdapter(chainName: SupportedChain): EVMAdapter {
  const chain   = viemChains[chainName];
  const rpc     = RPC[chainName];
  const appKitChainName = APP_KIT_CHAIN_NAMES[chainName];

  return {
    chainName,
    appKitChainName,
    publicClient: createPublicClient({ chain, transport: http(rpc) }),
    getWalletClient: (account, provider) => {
      const transport = provider ? custom(provider) : http(rpc);
      return createWalletClient({ account, chain, transport });
    },
  };
}

// ─── Interfaces ───────────────────────────────────────────────────────────────
export interface SwapParams {
  from: { adapter: EVMAdapter; chain: SupportedChain };
  tokenIn: string;
  tokenOut: string;
  amount: string;
  slippageTolerance?: number;
}

export interface BridgeParams {
  from: { adapter: EVMAdapter; chain: SupportedChain };
  to:   { adapter: EVMAdapter; chain: SupportedChain };
  token: string;
  amount: string;
}

export interface SendParams {
  from: { adapter: EVMAdapter; chain: SupportedChain };
  to: string;
  token: string;
  amount: string;
}

export interface SwapResult   { txHash: string; outputAmount: string; }
export interface BridgeResult { txHash: string; }
export interface SendResult   { txHash: string; }

export interface AppKitConfig {
  adapters: Record<SupportedChain, EVMAdapter>;
  swap:   (params: SwapParams)   => Promise<SwapResult>;
  bridge: (params: BridgeParams) => Promise<BridgeResult>;
  send:   (params: SendParams)   => Promise<SendResult>;
}

// ─── Adapters ─────────────────────────────────────────────────────────────────
export const adapters: Record<SupportedChain, EVMAdapter> = {
  Ethereum_Sepolia: createEVMAdapter('Ethereum_Sepolia'),
  BNB_Testnet:      createEVMAdapter('BNB_Testnet'),
  Base_Sepolia:     createEVMAdapter('Base_Sepolia'),
  Arc_Testnet:      createEVMAdapter('Arc_Testnet'),
};

// ─── Kit factory ──────────────────────────────────────────────────────────────
async function buildKit(): Promise<AppKitConfig> {
  let sdkKit: any = null;

  try {
    const { AppKit } = await import('@circle-fin/app-kit' as any);
    sdkKit = new AppKit({
      apiKey:   process.env.CIRCLE_APP_KIT_API_KEY,
      clientId: process.env.CIRCLE_APP_KIT_CLIENT_ID,
    });
    console.log('[AppKit] ✅ Circle App Kit SDK loaded');
  } catch {
    console.warn('[AppKit] ⚠️  Running in simulation mode (no SDK found)');
  }

  const kit: AppKitConfig = {
    adapters,

    async swap(params: SwapParams): Promise<SwapResult> {
      // Map internal chain/token names to what App Kit expects
      const appKitChain  = APP_KIT_CHAIN_NAMES[params.from.chain];
      const appKitToken  = APP_KIT_TOKEN_SYMBOL[params.tokenIn] ?? params.tokenIn;
      const appKitTokenOut = APP_KIT_TOKEN_SYMBOL[params.tokenOut] ?? params.tokenOut;

      console.log(`[AppKit] swap  ${params.amount} ${params.tokenIn}(→${appKitToken}) on ${params.from.chain}(→${appKitChain})`);

      if (sdkKit) {
        return sdkKit.swap({
          from: {
            chain:         appKitChain,
            walletAddress: params.from.adapter.getWalletClient,
          },
          tokenIn:          appKitToken,
          tokenOut:         appKitTokenOut,
          amountIn:         params.amount,
          slippageTolerance: params.slippageTolerance ?? 50,
        });
      }

      await delay(800);
      return { txHash: mockTxHash(), outputAmount: applyFee(params.amount) };
    },

    async bridge(params: BridgeParams): Promise<BridgeResult> {
      const fromChain  = APP_KIT_CHAIN_NAMES[params.from.chain];
      const toChain    = APP_KIT_CHAIN_NAMES[params.to.chain];
      const appKitToken = APP_KIT_TOKEN_SYMBOL[params.token] ?? params.token;

      console.log(`[AppKit] bridge ${params.amount} ${appKitToken}: ${fromChain} → ${toChain}`);

      if (sdkKit) {
        return sdkKit.bridge({
          from:   { chain: fromChain },
          to:     { chain: toChain },
          token:  appKitToken,
          amount: params.amount,
        });
      }

      await delay(1200);
      return { txHash: mockTxHash() };
    },

    async send(params: SendParams): Promise<SendResult> {
      const appKitChain = APP_KIT_CHAIN_NAMES[params.from.chain];
      const appKitToken = APP_KIT_TOKEN_SYMBOL[params.token] ?? params.token;

      console.log(`[AppKit] send  ${params.amount} ${appKitToken} → ${params.to} on ${appKitChain}`);

      if (sdkKit) {
        return sdkKit.send({
          from:   { chain: appKitChain },
          to:     params.to,
          token:  appKitToken,
          amount: params.amount,
        });
      }

      await delay(600);
      return { txHash: mockTxHash() };
    },
  };

  return kit;
}

// ─── Singleton ────────────────────────────────────────────────────────────────
let _kit: AppKitConfig | null = null;
export async function getKit(): Promise<AppKitConfig> {
  if (!_kit) _kit = await buildKit();
  return _kit;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const delay     = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mockTxHash = () => `0x${[...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;
const applyFee   = (amount: string) =>
  (parseFloat(amount) * (1 - parseFloat(process.env.FEE_PERCENT ?? '0.3') / 100)).toFixed(6);
