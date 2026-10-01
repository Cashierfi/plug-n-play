import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'PNPCoinbase',
      fileName: (format) => `index.${format === 'es' ? 'es.' : ''}js`,
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: [
        '@windoge98/plug-n-play',
        '@icp-sdk/core/agent',
        '@icp-sdk/core/identity',
        '@icp-sdk/core/principal',
        '@icp-sdk/core/candid',
        '@solana/wallet-adapter-base',
        '@solana/wallet-adapter-coinbase',
        '@solana/web3.js',
        'bs58',
        'buffer',
        'process'
      ],
      output: {
        globals: {
          '@windoge98/plug-n-play': 'PlugNPlay',
          '@icp-sdk/core/agent': 'agent',
          '@icp-sdk/core/identity': 'identity',
          '@icp-sdk/core/principal': 'principal',
          '@icp-sdk/core/candid': 'candid',
          '@solana/wallet-adapter-base': 'walletAdapterBase',
          '@solana/wallet-adapter-coinbase': 'walletAdapterCoinbase',
          '@solana/web3.js': 'solanaWeb3',
          'bs58': 'bs58'
        }
      }
    },
    minify: false,
    sourcemap: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
});