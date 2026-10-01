import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'
import inject from '@rollup/plugin-inject'

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        dev: true,
        compatibility: {
          componentApi: 4
        },
        hmr: true
      }
    }),
    // Inject Buffer and process polyfills for browser
    inject({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser.js',
    }),
  ],
  resolve: {
    alias: {
      '@pnp': path.resolve(__dirname, '../../src'),
      'process/browser.js': path.resolve(__dirname, 'node_modules/process/browser.js'),
      'process/browser': path.resolve(__dirname, 'node_modules/process/browser.js'),
    },
  },
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    },
    include: [
      'buffer',
      'process/browser',
    ]
  },
  build: {
    target: 'esnext',
  },
  server: {
    port: 3000,
    open: true
  }
})
