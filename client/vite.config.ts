import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'node:path'

// Allow overriding backend URL; default to Docker service name only when explicitly running in Docker.
const apiTarget =
  process.env.VITE_API_URL ||
  (process.env.RUNNING_IN_DOCKER === 'true' ? 'http://server:3000' : 'http://localhost:3000')

export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'classic',
    }),
    // PDF.js needs its bundled standard fonts and cmaps served alongside the
    // app — without them the viewer falls back to system fonts whose metrics
    // shift the text-layer span positions, breaking selection alignment.
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/pdfjs-dist/standard_fonts/*',
          dest: 'pdfjs-standard-fonts',
        },
        {
          src: 'node_modules/pdfjs-dist/cmaps/*',
          dest: 'pdfjs-cmaps',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy REST API calls to the ASP.NET Core backend
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      // Proxy Yjs websocket connections to the ASP.NET Core backend
      '/ws': {
        target: apiTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
})
