/**
 * src/App.jsx
 * 최상위 컴포넌트 — 상태 연결과 레이아웃만 담당
 *
 * 앱 탭: library | actors | recommendations | dashboard
 * 라이브러리 서브탭: all | new | recommended
 */
import { useState, useEffect, useCallback } from 'react'
import { Alert } from 'antd'
import './App.css'

import { useVideoSearch }       from './hooks/useVideoSearch.js'
import SearchBar                from './components/SearchBar.jsx'
import FilterBar                from './components/FilterBar.jsx'
import TabBar                   from './components/TabBar.jsx'
import VideoList                from './components/VideoList.jsx'
import DetailPanel              from './components/DetailPanel.jsx'
import RandomPanel              from './components/RandomPanel.jsx'
import ActorPickPanel           from './components/ActorPickPanel.jsx'
import DeleteCleanupModal       from './components/DeleteCleanupModal.jsx'
import FolderPanel              from './components/FolderPanel.jsx'
import FileCopyModal            from './components/FileCopyModal.jsx'
import HeaderActionBar          from './components/HeaderActionBar.jsx'
import ActorsPage               from './pages/Actors/index.jsx'
import RecommendationsPage      from './pages/Recommendations/index.jsx'
import DashboardPage            from './pages/Dashboard/index.jsx'
import StoragePage              from './pages/Storage/index.jsx'

export default function App() {
  // ── 앱 탭 ('library' | 'actors' | 'recommendations' | 'dashboard')
  const [appTab, setAppTab] = useState('library')

  // ── 영상 검색 훅 ──────────────────────────────────────────────
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
  const [folderPath,        setFolderPath]        = useState(null)
  const [selectedVideo,     setSelectedVideo]     = useState(null)
  const [scanning,          setScanning]          = useState(false)
  const [scanInfo,          setScanInfo]          = useState(null)
  const [randomResult,      setRandomResult]      = useState(null)
  const [actorPickResult,   setActorPickResult]   = useState(null)
  const [actorPicking,      setActorPicking]      = useState(false)
  const [showDeleteModal,   setShowDeleteModal]   = useState(false)
  const [showFileCopyModal, setShowFileCopyModal] = useState(false)
  const [checkedIds,        setCheckedIds]        = useState(new Set())
  const [folderRefreshKey,  setFolderRefreshKey]  = useState(0)
  const [newCount,          setNewCount]          = useState(0)
  const [isAutoScanning,    setIsAutoScanning]    = useState(false)

  // ── NEW 카운트 갱신 ───────────────────────────────────────────
  const refreshNewCount = useCallback(async () => {
    try {
      const { count } = await window.api.getNewCount()
      setNewCount(count)
    } catch { /* 조용히 무시 */ }
  }, [])

  // 앱 시작 시 DB 조회 + NEW count만 (스캔 없음)
  useEffect(() => {
    refreshNewCount()
  }, [refreshNewCount])

  // ── 폴더 선택 ─────────────────────────────────────────────────
  const handleSelectFolder = async () => {
    try {
      const selected = await window.api.selectFolder()
      if (selected) { setFolderPath(selected); setScanInfo(null); setError(null) }
    } catch (e) { setError('폴더 선택 실패: ' + e.message) }
  }

  // ── 폴더 스캔 ─────────────────────────────────────────────────
  const handleScan = async () => {
    setError(null); setScanInfo(null); setScanning(true)
    if (!folderPath) {
      try {
        const { folders } = await window.api.getFolderList()
        if (!folders || folders.length === 0) {
          setError('등록된 폴더가 없습니다. 먼저 폴더를 선택하고 스캔해주세요.')
          return
        }
        const { count: prevNew } = await window.api.getNewCount()
        let totalFiles = 0, missingCount = 0
        for (const folder of folders) {
          const scanPath = folder.root_path || folder.path
          if (!scanPath) continue
          try {
            const r = await window.api.scanFolder(scanPath)
            totalFiles   += r.totalFiles
            missingCount += r.missingCount
          } catch (err) { console.error('전체 스캔 실패:', scanPath, err) }
        }
        await refresh()
        const { count: nextNew } = await window.api.getNewCount()
        setNewCount(nextNew)
        setFolderRefreshKey((k) => k + 1)
        setScanInfo({ totalFiles, missingCount, scannedFolder: '전체 라이브러리', newAdded: Math.max(0, nextNew - prevNew) })
      } catch (e) { setError('전체 스캔 중 오류: ' + e.message) }
      finally { setScanning(false) }
      return
    }
    try {
      const { count: prevNew } = await window.api.getNewCount()
      const result = await window.api.scanFolder(folderPath)
      await refresh()
      const { count: nextNew } = await window.api.getNewCount()
      setNewCount(nextNew)
      setFolderRefreshKey((k) => k + 1)
      changeFolder(result.scannedFolder)
      setScanInfo({ ...result, newAdded: Math.max(0, nextNew - prevNew) })
    } catch (e) { setError('스캔 중 오류: ' + e.message) }
    finally { setScanning(false) }
  }

  // ── 랜덤 추천 ─────────────────────────────────────────────────
  const handleRandomPick = async () => {
    try {
      const result = await window.api.randomPick(searchQuery, { hideMissing: filters.excludeMissing, currentFolder })
      setRandomResult(result)
    } catch (e) { setError('랜덤 추천 실패: ' + e.message) }
  }

  // ── 배우별 1개 추출 ───────────────────────────────────────────
  const handleActorPick = async () => {
    setActorPicking(true)
    try {
      const result = await window.api.pickOnePerActor(searchQuery, { hideMissing: filters.excludeMissing, currentFolder })
      setActorPickResult(result)
    } catch (e) { setError('배우별 추출 실패: ' + e.message) }
    finally { setActorPicking(false) }
  }

  // ── 파일 복사 모달 ────────────────────────────────────────────
  const handleOpenFileCopy = useCallback(() => setShowFileCopyModal(true), [])

  // ── 체크박스 ──────────────────────────────────────────────────
  const handleToggleCheck = useCallback((_e, id) => {
    setCheckedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }, [])
  const handleToggleAll = useCallback((checkAll) => {
    setCheckedIds(checkAll ? new Set(videos.map((v) => v.id)) : new Set())
  }, [videos])

  // ── NEW 해제 ──────────────────────────────────────────────────
  const handleClearCheckedNew = async () => {
    if (checkedIds.size === 0) return
    try {
      await Promise.all(
        Array.from(checkedIds).map((id) =>
          window.api.updateVideoMeta(id, {
            memo: '', tags: '', rating: 0, status: 'normal', recommended: 0, grade: '보관',
          })
        )
      )
      await refresh()
      await refreshNewCount()
      setCheckedIds(new Set())
    } catch (e) { setError('NEW 해제 실패: ' + e.message) }
  }

  const handleClearAllNew = async () => {
    if (videos.length === 0) return
    if (!window.confirm(`NEW 상태 ${videos.length}개를 전부 해제할까요?`)) return
    try {
      await Promise.all(
        videos.map((v) =>
          window.api.updateVideoMeta(v.id, {
            memo: v.memo || '', tags: v.tags || '', rating: v.rating || 0,
            status: v.status || 'normal', recommended: v.recommended || 0, grade: v.grade || '보관',
          })
        )
      )
      await refresh()
      await refreshNewCount()
    } catch (e) { setError('전체 NEW 해제 실패: ' + e.message) }
  }

  // ── 배우-영상 동기화 ──────────────────────────────────────────
  const handleActorSync = async () => {
    try {
      const result = await window.api.syncActorVideos()
      setScanInfo({ totalFiles: result.synced, missingCount: 0, scannedFolder: '배우-영상 동기화', newAdded: 0 })
    } catch (e) { setError('동기화 실패: ' + e.message) }
  }

  // ── 삭제 완료 ─────────────────────────────────────────────────
  const handleDeleted = useCallback(() => { refresh(); setFolderRefreshKey((k) => k + 1) }, [refresh])

  // ── 메타 업데이트 ─────────────────────────────────────────────
  const handleVideoUpdated = useCallback((updated) => {
    setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)))
    setSelectedVideo(updated)
    refreshNewCount()
  }, [refreshNewCount])

  // ── 전체 새로고침 ─────────────────────────────────────────────
  const handleRefreshSearch = async () => {
    try {
      setIsAutoScanning(true)
      const { folders } = await window.api.getFolderList()
      if (folders && folders.length > 0) {
        for (const folder of folders) {
          const scanPath = folder.root_path || folder.path
          if (!scanPath) continue
          try { await window.api.scanFolder(scanPath) } catch (err) {
            console.error('새로고침 스캔 실패:', scanPath, err)
          }
        }
      }
      await refresh()
      await refreshNewCount()
      setFolderRefreshKey((k) => k + 1)
    } catch (err) { setError('새로고침 실패: ' + err.message) }
    finally { setIsAutoScanning(false) }
  }

  const viewLabel = currentFolder || '전체 라이브러리'

  return (
    <div className="app">
      {/* 헤더 */}
      <header className="app-header">
        <div className="header-brand">
          <h1 className="app-title">Actor Picker</h1>
        </div>

        {/* 앱 레벨 탭 */}
        <div className="app-tab-switcher">
          {[
            { key: 'library',         label: '영상 관리' },
            { key: 'actors',          label: '배우 관리' },
            { key: 'recommendations', label: '🎬 추천·탐색' },
            { key: 'dashboard',       label: '대시보드' },
            { key: 'storage',         label: '💾 저장소' },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`app-tab-btn ${appTab === key ? 'app-tab-btn--active' : ''}`}
              onClick={() => setAppTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 탭별 액션 버튼 */}
        <HeaderActionBar
          appTab={appTab}
          tabMode={tabMode}
          videos={videos}
          checkedIds={checkedIds}
          scanning={scanning}
          actorPicking={actorPicking}
          folderPath={folderPath}
          isAutoScanning={isAutoScanning}
          onSelectFolder={handleSelectFolder}
          onScan={handleScan}
          onRandomPick={handleRandomPick}
          onActorPick={handleActorPick}
          onOpenFileCopy={handleOpenFileCopy}
          onShowDeleteModal={() => setShowDeleteModal(true)}
          onRefreshNew={handleRefreshSearch}
          onClearCheckedNew={handleClearCheckedNew}
          onClearAllNew={handleClearAllNew}
          onNewActor={() => {}}   /* ActorsPage 내부에서 관리 */
          onSync={handleActorSync}
          onRecRefresh={() => {}} /* RecommendationsPage 내부에서 관리 */
          onDashRefresh={() => window.location.reload()}
        />
      </header>

      {/* ── 배우 관리 탭 ─────────────────────────────────── */}
      {appTab === 'actors' && <ActorsPage />}

      {/* ── 추천·탐색 탭 ─────────────────────────────────── */}
      {/* display:none 방식으로 유지 — 탭 이동 시 AI 결과 state 보존 */}
      <div style={{ display: appTab === 'recommendations' ? 'contents' : 'none' }}>
        <RecommendationsPage onCopyFiles={handleOpenFileCopy} />
      </div>

      {/* ── 대시보드 탭 ──────────────────────────────────── */}
      {appTab === 'dashboard' && (
        <DashboardPage
          onViewDetail={(videoId) => {
            // 라이브러리 탭으로 이동 후 해당 영상 선택 시도
            setAppTab('library')
            // 영상 목록에서 찾아서 선택 (로드된 경우)
            setSelectedVideo((prev) => {
              const found = videos.find(v => v.id === videoId)
              return found || prev
            })
          }}
          onCopyFiles={handleOpenFileCopy}
        />
      )}

      {/* ── 저장소 관리 탭 ───────────────────────────────── */}
      {appTab === 'storage' && <StoragePage />}

      {/* ── 영상 관리 탭 ─────────────────────────────────── */}
      {appTab === 'library' && (
        <>
          <TabBar
            tabMode={tabMode}
            onTabChange={changeTab}
            newCount={newCount}
            currentFolder={currentFolder}
          />
          <SearchBar
            query={searchQuery}
            onQueryChange={search}
            onSearch={handleRefreshSearch}
            sortBy={sortBy}
            onSortChange={changeSort}
          />
          <FilterBar
            filters={filters}
            onFiltersChange={changeFilters}
            totalCount={videos.length}
            totalSize={videos.reduce((s, v) => s + (v.size || 0), 0)}
          />
          <div className="view-indicator">
            <span className="view-indicator-label">현재 보기</span>
            <span className="view-indicator-path" title={viewLabel}>{viewLabel}</span>
            {isAutoScanning && (
              <span className="view-indicator-scanning">라이브러리 확인 중…</span>
            )}
          </div>

          {scanInfo && (
            <Alert
              type="success" showIcon closable
              onClose={() => setScanInfo(null)}
              style={{ borderRadius: 0, flexShrink: 0 }}
              message={
                <>
                  {scanInfo.scannedFolder === '전체 라이브러리' ? '전체 라이브러리 스캔 완료'
                    : scanInfo.scannedFolder === '배우-영상 동기화' ? '배우-영상 동기화 완료'
                    : '스캔 완료'}
                  {' — '}<strong>{scanInfo.totalFiles}</strong>개 처리
                  {(scanInfo.newAdded ?? 0) > 0 && (
                    <span style={{ color: '#22c55e', marginLeft: 8 }}>
                      · NEW <strong>{scanInfo.newAdded}</strong>개 발견
                    </span>
                  )}
                  {(scanInfo.newAdded ?? 0) === 0 && scanInfo.scannedFolder !== '배우-영상 동기화' && (
                    <span style={{ color: '#6b7280', marginLeft: 8 }}>· 신규 없음</span>
                  )}
                  {(scanInfo.missingCount ?? 0) > 0 && (
                    <span style={{ color: '#ef4444', marginLeft: 8 }}>
                      · 삭제됨 <strong>{scanInfo.missingCount}</strong>개 감지
                    </span>
                  )}
                </>
              }
            />
          )}

          {error && (
            <Alert
              type="error" showIcon closable
              onClose={() => setError(null)}
              message={error}
              style={{ borderRadius: 0, flexShrink: 0 }}
            />
          )}

          <div className="app-content">
            <FolderPanel
              currentFolder={currentFolder}
              onSelectFolder={changeFolder}
              refreshKey={folderRefreshKey}
            />
            <VideoList
              videos={videos}
              selectedId={selectedVideo?.id}
              onSelect={setSelectedVideo}
              loading={loading}
              checkedIds={checkedIds}
              onToggleCheck={handleToggleCheck}
              onToggleAll={handleToggleAll}
            />
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
        </>
      )}

      {/* 랜덤 추천 모달 */}
      {randomResult && (
        <RandomPanel result={randomResult} onClose={() => setRandomResult(null)} />
      )}

      {/* 배우별 추출 모달 */}
      {actorPickResult && (
        <ActorPickPanel result={actorPickResult} onClose={() => setActorPickResult(null)} />
      )}

      {/* 삭제요망 정리 모달 */}
      {showDeleteModal && (
        <DeleteCleanupModal
          onClose={() => setShowDeleteModal(false)}
          onDeleted={handleDeleted}
          currentFolder={currentFolder}
        />
      )}

      {/* 파일 복사 모달 */}
      {showFileCopyModal && (
        <FileCopyModal
          videos={videos}
          selectedIds={checkedIds}
          onClose={() => { setShowFileCopyModal(false); setCheckedIds(new Set()) }}
        />
      )}
    </div>
  )
}


