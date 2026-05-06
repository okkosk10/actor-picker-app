/**
 * src/App.jsx
 * 최상위 컴포넌트 — 상태 연결과 레이아웃만 담당
 *
 * 레이아웃:
 *   header → TabBar → SearchBar → FilterBar → (scan-info) → (error)
 *   → app-content[ FolderPanel | VideoList | DetailPanel ]
 *   RandomPanel 모달, ActorPickPanel 모달, DeleteCleanupModal 모달
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Alert } from 'antd'
import './App.css'

import { useVideoSearch }    from './hooks/useVideoSearch.js'
import SearchBar             from './components/SearchBar.jsx'
import FilterBar             from './components/FilterBar.jsx'
import TabBar                from './components/TabBar.jsx'
import VideoList             from './components/VideoList.jsx'
import DetailPanel           from './components/DetailPanel.jsx'
import RandomPanel           from './components/RandomPanel.jsx'
import ActorPickPanel        from './components/ActorPickPanel.jsx'
import DeleteCleanupModal    from './components/DeleteCleanupModal.jsx'
import FolderPanel           from './components/FolderPanel.jsx'
import OrResultModal         from './components/OrResultModal.jsx'

export default function App() {
  // ── 동영상 목록 검색/정렬/폴더 상태 (hook) ─────────────────────
  const {
    videos, setVideos,
    searchQuery, search,
    sortBy, changeSort,
    filters, changeFilters,
    tabMode, changeTab,
    currentFolder, changeFolder,
    loading, error, setError,
    refresh,
  } = useVideoSearch()

  // ── 로컬 UI 상태 ──────────────────────────────────────────────
  const [folderPath,       setFolderPath]       = useState(null)
  const [selectedVideo,    setSelectedVideo]    = useState(null)
  const [scanning,         setScanning]         = useState(false)
  const [scanInfo,         setScanInfo]         = useState(null)
  const [randomResult,     setRandomResult]     = useState(null)
  // 배우별 1개 추출 결과 모달
  const [actorPickResult,  setActorPickResult]  = useState(null)
  const [actorPicking,     setActorPicking]     = useState(false)
  // 삭제요망 정리 모달 표시 여부
  const [showDeleteModal,  setShowDeleteModal]  = useState(false)
  // 검색 결과 OR문 모달 표시 여부
  const [showOrModal,      setShowOrModal]      = useState(false)
  // FolderPanel 새로고침 트리거 (스캔/삭제 완료 시 증가)
  const [folderRefreshKey, setFolderRefreshKey] = useState(0)
  // NEW 탭 배지 숫자 (is_new=1 파일 수)
  const [newCount,         setNewCount]         = useState(0)
  // 앱 시작 시 자동 스캔 상태
  const [isAutoScanning,   setIsAutoScanning]   = useState(false)
  // 자동 스캔 중복 실행 방지
  const hasAutoScannedRef = useRef(false)

  /**
   * NEW 카운트를 DB에서 갱신한다.
   * 스캔 완료, 메타 업데이트, 탭 전환 시 호출한다.
   */
  const refreshNewCount = useCallback(async () => {
    try {
      const { count } = await window.api.getNewCount()
      setNewCount(count)
    } catch {
      // 카운트 조회 실패는 조용히 무시
    }
  }, [])

  // 앱 시작 시 NEW 카운트 초기 조회
  useEffect(() => { refreshNewCount() }, [refreshNewCount])

  // ── 앱 시작 시 등록된 폴더 자동 스캔 ─────────────────────────
  useEffect(() => {
    if (hasAutoScannedRef.current) return
    hasAutoScannedRef.current = true

    const autoScanRegisteredFolders = async () => {
      try {
        setIsAutoScanning(true)
        const { folders } = await window.api.getFolderList()
        if (!folders || folders.length === 0) return

        for (const folder of folders) {
          const scanPath = folder.root_path || folder.path
          if (!scanPath) continue
          try {
            await window.api.scanFolder(scanPath)
          } catch (err) {
            console.error('자동 스캔 실패:', scanPath, err)
          }
        }

        await refresh()
        await refreshNewCount()
        setFolderRefreshKey((k) => k + 1)
      } catch (err) {
        console.error('앱 시작 자동 스캔 실패:', err)
      } finally {
        setIsAutoScanning(false)
      }
    }

    autoScanRegisteredFolders()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 폴더 선택 ─────────────────────────────────────────────────
  const handleSelectFolder = async () => {
    try {
      const selected = await window.api.selectFolder()
      if (selected) {
        setFolderPath(selected)
        setScanInfo(null)
        setError(null)
      }
    } catch (e) {
      setError('폴더 선택 실패: ' + e.message)
    }
  }

  // ── 폴더 스캔 ─────────────────────────────────────────────────
  // - folderPath 선택 시: 해당 폴더만 스캔 (기존 동작)
  // - folderPath 미선택 시: 등록된 모든 폴더 전체 스캔
  const handleScan = async () => {
    setError(null)
    setScanInfo(null)
    setScanning(true)

    // 전체 라이브러리 스캔 (폴더 미선택 시)
    if (!folderPath) {
      try {
        const { folders } = await window.api.getFolderList()
        if (!folders || folders.length === 0) {
          setError('등록된 폴더가 없습니다. 먼저 폴더를 선택하고 스캔해주세요.')
          return
        }

        const { count: prevNew } = await window.api.getNewCount()
        let totalFiles = 0
        let missingCount = 0

        for (const folder of folders) {
          const scanPath = folder.root_path || folder.path
          if (!scanPath) continue
          try {
            const result = await window.api.scanFolder(scanPath)
            totalFiles   += result.totalFiles
            missingCount += result.missingCount
          } catch (err) {
            console.error('전체 스캔 실패:', scanPath, err)
          }
        }

        await refresh()
        const { count: nextNew } = await window.api.getNewCount()
        setNewCount(nextNew)
        setFolderRefreshKey((k) => k + 1)
        setScanInfo({
          totalFiles,
          missingCount,
          scannedFolder: '전체 라이브러리',
          newAdded: Math.max(0, nextNew - prevNew),
        })
      } catch (e) {
        setError('전체 스캔 중 오류: ' + e.message)
      } finally {
        setScanning(false)
      }
      return
    }

    // 선택된 폴더 스캔 (기존 동작)
    try {
      const { count: prevNew } = await window.api.getNewCount()
      const result = await window.api.scanFolder(folderPath)
      await refresh()
      const { count: nextNew } = await window.api.getNewCount()
      setNewCount(nextNew)
      setFolderRefreshKey((k) => k + 1)
      changeFolder(result.scannedFolder)
      setScanInfo({
        ...result,
        newAdded: Math.max(0, nextNew - prevNew),
      })
    } catch (e) {
      setError('스캔 중 오류: ' + e.message)
    } finally {
      setScanning(false)
    }
  }

  // ── 랜덤 추천 (현재 폴더 기준) ────────────────────────────────
  const handleRandomPick = async () => {
    try {
      const result = await window.api.randomPick(searchQuery, {
        hideMissing: filters.excludeMissing,
        currentFolder,
      })
      setRandomResult(result)
    } catch (e) {
      setError('랜덤 추천 실패: ' + e.message)
    }
  }

  // ── 배우별 1개 추출 (현재 폴더 기준) ──────────────────────────
  const handleActorPick = async () => {
    setActorPicking(true)
    try {
      const result = await window.api.pickOnePerActor(searchQuery, {
        hideMissing: filters.excludeMissing,
        currentFolder,
      })
      setActorPickResult(result)
    } catch (e) {
      setError('배우별 추출 실패: ' + e.message)
    } finally {
      setActorPicking(false)
    }
  }

  // ── 검색 결과 OR문 모달 열기 (직접 복사 구조에서 모달 표시로 변경) ────
  const handleCopyOrText = () => {
    setShowOrModal(true)
  }

  // ── 삭제 완료 후 처리 ─────────────────────────────────────────
  const handleDeleted = () => {
    refresh()
    setFolderRefreshKey((k) => k + 1) // 폴더 패널 통계 갱신
  }

  // ── 메타 업데이트 동기화 ──────────────────────────────────────
  const handleVideoUpdated = (updated) => {
    setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)))
    setSelectedVideo(updated)
    // 메타 수정 시 is_new=0 처리됨 → NEW 카운트 갱신
    refreshNewCount()
  }

  // ── 현재 보기 레이블 ──────────────────────────────────────────
  const viewLabel = currentFolder
    ? currentFolder
    : '전체 라이브러리'

  // ── 전체 라이브러리 새로고침 (등록된 폴더 전체 재스캔 + 목록 갱신) ──
  const handleRefreshSearch = async () => {
    try {
      setIsAutoScanning(true)
      const { folders } = await window.api.getFolderList()
      if (folders && folders.length > 0) {
        for (const folder of folders) {
          const scanPath = folder.root_path || folder.path
          if (!scanPath) continue
          try {
            await window.api.scanFolder(scanPath)
          } catch (err) {
            console.error('새로고침 스캔 실패:', scanPath, err)
          }
        }
      }
      await refresh()
      await refreshNewCount()
      setFolderRefreshKey((k) => k + 1)
    } catch (err) {
      setError('새로고침 실패: ' + err.message)
    } finally {
      setIsAutoScanning(false)
    }
  }

  // ──────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* 헤더 */}
      <header className="app-header">
        <div className="header-brand">
          <h1 className="app-title">Actor Picker</h1>
        </div>
        <div className="header-actions">
          <button className="btn-primary" type="button" onClick={handleSelectFolder}>
            폴더 선택
          </button>
          {folderPath && (
            <span className="header-path" title={folderPath}>{folderPath}</span>
          )}
          <button
            className="btn-secondary"
            type="button"
            onClick={handleScan}
            disabled={scanning || isAutoScanning}
          >
            {scanning ? '스캔 중…' : (folderPath ? '스캔' : '전체 스캔')}
          </button>
          <button
            className="btn-random"
            type="button"
            onClick={handleRandomPick}
            disabled={videos.length === 0}
          >
            🎲 랜덤 추천
          </button>
          <button
            className="btn-actor-pick"
            type="button"
            onClick={handleActorPick}
            disabled={videos.length === 0 || actorPicking}
          >
            {actorPicking ? '추출 중…' : '🎯 배우별 1개 추출'}
          </button>
          <button
            className="btn-or-copy"
            type="button"
            onClick={handleCopyOrText}
            disabled={videos.length === 0}
          >
            📋 검색 결과 OR문 복사
          </button>
          <button
            className="btn-danger"
            type="button"
            onClick={() => setShowDeleteModal(true)}
          >
            🗑 삭제요망 정리
          </button>
        </div>
      </header>

      {/* 탭 바 */}
      <TabBar
        tabMode={tabMode}
        onTabChange={changeTab}
        newCount={newCount}
        currentFolder={currentFolder}
      />

      {/* 검색 바 */}
      <SearchBar
        query={searchQuery}
        onQueryChange={search}
        onSearch={handleRefreshSearch}
        sortBy={sortBy}
        onSortChange={changeSort}
      />

      {/* 필터 바 */}
      <FilterBar
        filters={filters}
        onFiltersChange={changeFilters}
        totalCount={videos.length}
        totalSize={videos.reduce((s, v) => s + (v.size || 0), 0)}
      />

      {/* 현재 보기 기준 표시 바 */}
      <div className="view-indicator">
        <span className="view-indicator-label">현재 보기</span>
        <span className="view-indicator-path" title={viewLabel}>{viewLabel}</span>
        {isAutoScanning && (
          <span className="view-indicator-scanning">라이브러리 확인 중…</span>
        )}
      </div>

      {/* 스캔 결과 알림 — closable Alert (X 닫기 + 신규 스캔 시 재표시) */}
      {scanInfo && (
        <Alert
          type="success"
          showIcon
          closable
          onClose={() => setScanInfo(null)}
          style={{ borderRadius: 0, flexShrink: 0 }}
          message={
            <>
              {scanInfo.scannedFolder === '전체 라이브러리' ? '전체 라이브러리 스캔 완료' : '스캔 완료'}
              {' — '}<strong>{scanInfo.totalFiles}</strong>개 처리
              {scanInfo.newAdded > 0 && (
                <span style={{ color: '#22c55e', marginLeft: 8 }}>
                  · NEW <strong>{scanInfo.newAdded}</strong>개 발견
                </span>
              )}
              {scanInfo.newAdded === 0 && (
                <span style={{ color: '#6b7280', marginLeft: 8 }}>
                  · 신규 없음
                </span>
              )}
              {scanInfo.missingCount > 0 && (
                <span style={{ color: '#ef4444', marginLeft: 8 }}>
                  · 삭제됨 <strong>{scanInfo.missingCount}</strong>개 감지
                </span>
              )}
            </>
          }
        />
      )}

      {/* 에러 메시지 — closable Alert */}
      {error && (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setError(null)}
          message={error}
          style={{ borderRadius: 0, flexShrink: 0 }}
        />
      )}

      {/* 메인 콘텐츠 (폴더패널 + 목록 + 상세) */}
      <div className="app-content">

        {/* 좌측: 스캔 폴더 목록 패널 */}
        <FolderPanel
          currentFolder={currentFolder}
          onSelectFolder={changeFolder}
          refreshKey={folderRefreshKey}
        />

        {/* 중앙: 영상 목록 */}
        <VideoList
          videos={videos}
          selectedId={selectedVideo?.id}
          onSelect={setSelectedVideo}
          loading={loading}
        />

        {/* 우측: 상세 정보 */}
        <div className="detail-panel-wrap">
          {selectedVideo ? (
            <DetailPanel
              video={selectedVideo}
              onUpdate={handleVideoUpdated}
              onOpenVideo={(fp) => window.api.openVideo(fp)}
              onOpenFolder={(fp) => window.api.openFolder(fp)}
            />
          ) : (
            <div className="detail-empty">
              <div className="detail-empty-icon">👈</div>
              <p>동영상을 선택하면 상세 정보가 표시됩니다.</p>
            </div>
          )}
        </div>
      </div>

      {/* 랜덤 추천 모달 */}
      {randomResult && (
        <RandomPanel
          result={randomResult}
          onClose={() => setRandomResult(null)}
        />
      )}

      {/* 배우별 1개 추출 결과 모달 */}
      {actorPickResult && (
        <ActorPickPanel
          result={actorPickResult}
          onClose={() => setActorPickResult(null)}
        />
      )}

      {/* 삭제요망 정리 모달 (현재 폴더 기준) */}
      {showDeleteModal && (
        <DeleteCleanupModal
          onClose={() => setShowDeleteModal(false)}
          onDeleted={handleDeleted}
          currentFolder={currentFolder}
        />
      )}

      {/* 검색 결과 OR문 모달 */}
      {showOrModal && (
        <OrResultModal
          videos={videos}
          onClose={() => setShowOrModal(false)}
        />
      )}
    </div>
  )
}
