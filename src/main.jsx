import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// StrictMode는 개발용 검사 도구 : 앱을 더 안전하게 만들기 위해 문제 될 수 있는 코드 찾아주는 역할
// 실제 사용자 화면에는 영향 없음 (개발할 때만 작동)