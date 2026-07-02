import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  envDir: '../../',
  plugins: [
    vue(),
    ui()
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
  }
})
