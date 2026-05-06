import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import koKR from 'antd/locale/ko_KR'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/*
      ConfigProvider:
        - locale=koKR  : Ant Design 컴포넌트 한국어화
        - algorithm     : 다크 테마 적용 (앱 전체 테마와 통일)
    */}
    <ConfigProvider
      locale={koKR}
      theme={{ algorithm: theme.darkAlgorithm }}
    >
      <App />
    </ConfigProvider>
  </StrictMode>,
)

