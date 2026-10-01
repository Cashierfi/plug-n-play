import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'PnpRabby',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'es' : ''}.js`
    },
    rollupOptions: {
      external: [
        '@windoge98/plug-n-play',
        '@icp-sdk/core/agent',
        '@icp-sdk/core/identity',
        '@icp-sdk/core/principal',
        '@icp-sdk/core/candid',
        '@icp-sdk/auth/client'
      ],
      output: {
        globals: {
          '@windoge98/plug-n-play': 'PlugNPlay',
          '@icp-sdk/core/agent': 'DfinityAgent',
          '@icp-sdk/core/identity': 'DfinityIdentity',
          '@icp-sdk/core/principal': 'DfinityPrincipal'
        }
      }
    },
    sourcemap: true,
    minify: false
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});