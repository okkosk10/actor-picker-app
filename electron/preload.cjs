const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 필요한 IPC 메서드를 여기에 추가
})
