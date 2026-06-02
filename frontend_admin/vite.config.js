import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 관리자 프론트는 사용자 앱(3000)과 충돌하지 않도록 3001 포트를 쓴다.
// /api, /uploads 는 같은 백엔드(8000)로 프록시 → 브라우저 입장에선 동일 출처라
// 쿠키 인증이 그대로 동작하고 CORS 문제가 없다.
// 127.0.0.1 명시: Windows에서 localhost가 IPv6(::1)로 풀려 WSL relay에 막히는 케이스 회피
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
