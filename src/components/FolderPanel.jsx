/**
 * src/components/FolderPanel.jsx
 * 스캔된 폴더 목록 사이드바 패널
 *
 * Props:
 *   currentFolder     {string|null} - 현재 선택된 폴더 경로 (null = 전체 라이브러리)
 *   onSelectFolder    {Function}    - 폴더 선택 콜백 (path: string|null)
 *   onToggleFolderActive {Function} - 폴더 활성화/비활성화 토글 콜백 (path: string)
 *   refreshKey        {number}      - 이 값이 바뀌면 폴더 목록을 새로 조회한다
 *                                     (스캔/삭제 완료 후 App에서 증가시킴)
 *
 * 표시 항목:
 *   [전체 라이브러리]  N개
 *   [D:\VIDEO\A]      N개 / 추천 N / 삭제요망 N (활성화/비활성화 토글)
 *   ...
 */
import { useState, useEffect, useCallback } from 'react'

export default function FolderPanel({ currentFolder, onSelectFolder, onToggleFolderActive, refreshKey }) {
  // { library: { total, recommended_count, delete_count }, folders: [...] }
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)

  const loadFolders = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.getFolderList()
      setData(result)
    } catch {
      // 폴더 목록 조회 실패는 치명적이지 않으므로 조용히 처리
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // 마운트 시 + refreshKey가 바뀔 때마다 재조회
  useEffect(() => {
    loadFolders()
  }, [loadFolders, refreshKey])

  // 폴더명만 표시 (경로가 길면 마지막 세그먼트 2개만)
  const shortPath = (fullPath) => {
    if (!fullPath) return ''
    // Windows(\) 또는 Unix(/) 구분자로 분리
    const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean)
    if (parts.length <= 2) return fullPath
    return '…\\' + parts.slice(-2).join('\\')
  }

  // 폴더 활성화/비활성화 토글 (App의 핸들러 호출)
  const handleToggleFolderActive = async (e, folderPath) => {
    e.stopPropagation()
    if (onToggleFolderActive) {
      await onToggleFolderActive(folderPath)
    }
  }

  return (
    <aside className="folder-panel">
      <div className="folder-panel-header">
        <span className="folder-panel-title">📁 폴더</span>
        <button
          className="folder-panel-refresh"
          type="button"
          onClick={loadFolders}
          title="폴더 목록 새로고침"
          disabled={loading}
        >
          {loading ? '…' : '↺'}
        </button>
      </div>

      <div className="folder-panel-list">
        {/* 전체 라이브러리 항목 */}
        <button
          type="button"
          className={`folder-item ${currentFolder === null ? 'folder-item--active' : ''}`}
          onClick={() => onSelectFolder(null)}
          title="전체 라이브러리"
        >
          <span className="folder-item-icon">🗄</span>
          <span className="folder-item-body">
            <span className="folder-item-name">전체 라이브러리</span>
            {data?.library && (
              <span className="folder-item-stats">
                <span className="stat-total">{data.library.total}개</span>
                {data.library.recommended_count > 0 && (
                  <span className="stat-rec">★{data.library.recommended_count}</span>
                )}
                {data.library.delete_count > 0 && (
                  <span className="stat-del">🗑{data.library.delete_count}</span>
                )}
              </span>
            )}
          </span>
        </button>

        {/* 루트 폴더 목록 */}
        {data?.folders.length === 0 && (
          <p className="folder-panel-empty">스캔된 폴더 없음</p>
        )}
        {data?.folders.map((folder) => (
          <div
            key={folder.root_path}
            className={`folder-item-wrapper ${!folder.is_active ? 'folder-item-wrapper--disabled' : ''}`}
          >
            <button
              type="button"
              className={`folder-item ${currentFolder === folder.root_path ? 'folder-item--active' : ''} ${!folder.is_active ? 'folder-item--disabled' : ''}`}
              onClick={() => onSelectFolder(folder.root_path)}
              title={folder.root_path}
            >
              <span className="folder-item-icon">{folder.is_active ? '📂' : '📂‍🔒'}</span>
              <span className="folder-item-body">
                <span className="folder-item-name" title={folder.root_path}>
                  {shortPath(folder.root_path)}
                </span>
                <span className="folder-item-stats">
                  <span className="stat-total">{folder.total}개</span>
                  {folder.recommended_count > 0 && (
                    <span className="stat-rec">★{folder.recommended_count}</span>
                  )}
                  {folder.delete_count > 0 && (
                    <span className="stat-del">🗑{folder.delete_count}</span>
                  )}
                </span>
              </span>
            </button>
            {/* 폴더 활성화/비활성화 토글 버튼 */}
            <button
              type="button"
              className="folder-toggle-btn"
              onClick={(e) => handleToggleFolderActive(e, folder.root_path)}
              title={folder.is_active ? '폴더 비활성화 (파일 숨김)' : '폴더 활성화 (파일 표시)'}
            >
              {folder.is_active ? '👁' : '👁‍🗨'}
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
