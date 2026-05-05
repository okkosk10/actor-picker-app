import { useState } from 'react'
import './App.css'

function App() {
  const [folderPath, setFolderPath] = useState(null)

  const handleSelectFolder = async () => {
    const selected = await window.electronAPI.selectFolder()
    if (selected !== null) {
      setFolderPath(selected)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Actor Picker</h1>
        <p className="app-desc">
          폴더를 선택하면 파일명 괄호 안의 배우 이름 기준으로 작품을 분류합니다.
        </p>
      </header>

      <main className="app-main">
        <section className="folder-section">
          <button className="btn-primary" type="button" onClick={handleSelectFolder}>
            폴더 선택
          </button>
          <div className="folder-path">
            {folderPath
              ? <span className="path-text">{folderPath}</span>
              : <span className="path-placeholder">선택된 폴더가 없습니다</span>
            }
          </div>
        </section>

        <section className="result-section">
          {/* 파일 스캔 결과가 여기에 표시될 예정 */}
        </section>
      </main>
    </div>
  )
}

export default App
