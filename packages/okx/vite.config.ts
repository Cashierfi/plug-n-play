import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'PnpOkx',
      fileName: 'index',
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: [
        '@windoge98/plug-n-play',
        '@windoge98/pnp-solana',
        '@windoge98/pnp-ethereum',
        '@icp-sdk/core/agent',
        '@icp-sdk/core/identity',
        '@icp-sdk/core/principal',
        '@solana/web3.js',
        '@solana/wallet-adapter-base',
        'bs58'
      ],
      output: {
        globals: {
          '@windoge98/plug-n-play': 'PlugNPlay',
          '@windoge98/pnp-solana': 'PnpSolana',
          '@windoge98/pnp-ethereum': 'PnpEthereum',
          '@icp-sdk/core/agent': 'Agent',
          '@icp-sdk/core/identity': 'Identity',
          '@icp-sdk/core/principal': 'Principal',
          '@solana/web3.js': 'SolanaWeb3',
          '@solana/wallet-adapter-base': 'WalletAdapterBase',
          'bs58': 'bs58'
        }
      }
    },
    minify: false,
    sourcemap: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});