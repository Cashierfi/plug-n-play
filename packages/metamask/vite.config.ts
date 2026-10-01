import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'PNPMetaMask',
      fileName: (format) => format === 'es' ? 'index.es.js' : 'index.js',
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: [
        '@icp-sdk/core/agent',
        '@icp-sdk/core/identity', 
        '@icp-sdk/core/principal',
        '@windoge98/plug-n-play',
        /^@windoge98\//,
        'ic-siwe-js',
        'viem',
        'viem/chains'
      ],
      output: {
        globals: {
          '@icp-sdk/core/agent': 'DfinityAgent',
          '@icp-sdk/core/identity': 'DfinityIdentity',
          '@icp-sdk/core/principal': 'DfinityPrincipal',
          '@windoge98/plug-n-play': 'PNP',
          'ic-siwe-js': 'IcSiweJs',
          'viem': 'viem'
        }
      }
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'es2020',
    assetsInlineLimit: 100000 // Inline MetaMask logo
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
});