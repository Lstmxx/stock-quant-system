/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  envDir: '../../',
  plugins: [
    react()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: process.env.PORT_WEB ? parseInt(process.env.PORT_WEB as string) : 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT_API || 3000}`,
        changeOrigin: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['tests/**/*.{test,spec}.{ts,tsx}']
  }
})
