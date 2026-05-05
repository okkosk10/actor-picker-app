import { contextBridge } from 'electron'

// contextIsolation: true 환경에서 렌더러에 안전하게 API 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // 필요한 IPC 메서드를 여기에 추가
})
