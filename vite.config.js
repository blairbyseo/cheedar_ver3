import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // 프론트에서 /api/... 호출하면 백엔드(8000)으로 자동 전달
      // 127.0.0.1 명시: Windows에서 localhost가 IPv6(::1)로 풀려 WSL relay에 막히는 케이스 회피
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // 업로드된 이미지(/uploads/...)도 백엔드에서 서빙
      '/uploads': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
