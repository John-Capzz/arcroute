import { createConfig, http } from 'wagmi';
import { sepolia, bscTestnet, baseSepolia } from 'wagmi/chains';
import { injected, metaMask, coinbaseWallet } from 'wagmi/connectors';

export const config = createConfig({
  chains: [sepolia, bscTestnet, baseSepolia],
  connectors: [
    injected(),
    metaMask(),
    coinbaseWallet({ appName: 'ArcRoute' }),
  ],
  transports: {
    // Using multiple reliable public RPC endpoints
    [sepolia.id]: http('https://ethereum-sepolia-rpc.publicnode.com'),
    [bscTestnet.id]: http('https://bsc-testnet-rpc.publicnode.com'),
    [baseSepolia.id]: http('https://base-sepolia-rpc.publicnode.com'),
  },
  // Polling interval for balance updates
  pollingInterval: 4_000,
});
