import { useState } from 'react'
import './App.css'

function App() {
  const [folderPath, setFolderPath] = useState(null)
  const [scanResult, setScanResult] = useState(null)
  const [error, setError] = useState(null)
  const [scanning, setScanning] = useState(false)

  const handleSelectFolder = async () => {
    const selected = await window.electronAPI.selectFolder()
    if (selected !== null) {
      setFolderPath(selected)
      setScanResult(null)
      setError(null)
    }
  }

  const handleScan = async () => {
    if (!folderPath) {
      setError('먼저 폴더를 선택해주세요.')
      return
    }
    setError(null)
    setScanning(true)
    try {
      const result = await window.electronAPI.scanFolder(folderPath)
      setScanResult(result)
    } catch (e) {
      setError('스캔 중 오류가 발생했습니다: ' + e.message)
    } finally {
      setScanning(false)
    }
  }

  const handleCopy = () => {
    if (scanResult?.searchText) {
      navigator.clipboard.writeText(scanResult.searchText)
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
          <button
            className="btn-secondary"
            type="button"
            onClick={handleScan}
            disabled={!folderPath || scanning}
          >
            {scanning ? '스캔 중…' : '검색식 생성'}
          </button>
        </section>

        {error && <p className="error-msg">{error}</p>}

        {scanResult && (
          <section className="result-section result-section--filled">
            <div className="stats-row">
              <span className="stat-item">영상 파일 <strong>{scanResult.totalFiles}</strong>개</span>
              <span className="stat-sep">·</span>
              <span className="stat-item">배우 <strong>{scanResult.actorCount}</strong>명</span>
              <span className="stat-sep">·</span>
              <span className="stat-item">선택 <strong>{scanResult.pickedCount}</strong>개</span>
            </div>

            <div className="search-box">
              <div className="search-box-header">
                <span className="search-box-label">OR 검색식</span>
                <button className="btn-copy" type="button" onClick={handleCopy}>
                  복사
                </button>
              </div>
              <textarea
                className="search-textarea"
                readOnly
                value={scanResult.searchText}
                rows={3}
              />
            </div>

            <div className="picked-list">
              <p className="picked-list-title">선택된 작품 목록</p>
              <table className="picked-table">
                <thead>
                  <tr>
                    <th>배우</th>
                    <th>품번</th>
                    <th>파일명</th>
                  </tr>
                </thead>
                <tbody>
                  {scanResult.pickedList.map((item) => (
                    <tr key={item.fullPath}>
                      <td>{item.actor}</td>
                      <td><code>{item.code}</code></td>
                      <td className="td-filename">{item.fileName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!scanResult && !error && (
          <section className="result-section">
            폴더를 선택하고 검색식 생성 버튼을 누르세요
          </section>
        )}
      </main>
    </div>
  )
}

export default App
