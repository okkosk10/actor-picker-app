/**
 * src/App.jsx
 * 최상위 컴포넌트 — 상태 연결과 레이아웃만 담당
 *
 * 앱 탭: library | actors | recommendations | dashboard
 * 라이브러리 서브탭: all | new | recommended
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Alert, Modal } from 'antd'
import './App.css'

import { AiChatProvider } from './contexts/AiChatContext.jsx'
import { AiChatLauncher, AiChatDrawer, AiChatFullscreen } from './components/aiChat/AiChatShell.jsx'

import { useVideoSearch }       from './hooks/useVideoSearch.js'
import SearchBar                from './components/SearchBar.jsx'
import FilterBar                from './components/FilterBar.jsx'
import SubtitleDatePanel        from './components/SubtitleDatePanel.jsx'
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
import SubtitlesPage            from './pages/Subtitles/index.jsx'
import ActorTagBatchPage        from './pages/ActorTagBatch/index.jsx'
import { getLocalDateKey }      from './utils/format.js'

function extractDrive(value) {
  const match = String(value || '').trim().match(/^([A-Za-z]):/)
  return match ? `${match[1].toUpperCase()}:` : null
}

export default function App() {
  // ── 앱 탭 ('library' | 'actors' | 'actor-tags' | 'recommendations' | 'dashboard' | 'storage' | 'subtitles')
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
  const [newActorCount,     setNewActorCount]     = useState(0)
  const [isAutoScanning,    setIsAutoScanning]    = useState(false)
  const [selectedSubtitleDateKey, setSelectedSubtitleDateKey] = useState(null)
  const [showSubtitleDateModal, setShowSubtitleDateModal] = useState(false)
  const [driveAlerts,       setDriveAlerts]       = useState([])
  const [actorBadgeDefinitions, setActorBadgeDefinitions] = useState([])
  const [aiResultFilterMeta, setAiResultFilterMeta] = useState(null)

  // ── NEW 카운트 갱신 ───────────────────────────────────────────
  const refreshNewCount = useCallback(async () => {
    try {
      const { count } = await window.api.getNewCount()
      setNewCount(count)
    } catch { /* 조용히 무시 */ }
  }, [])

  // ── 새 배우 카운트 갱신 ──────────────────────────────────────
  const refreshNewActorCount = useCallback(async () => {
    try {
      const { count } = await window.api.getNewActorCount()
      setNewActorCount(count)
    } catch { /* 조용히 무시 */ }
  }, [])

  // 앱 시작 시 DB 조회 + NEW count만 (스캔 없음)
  useEffect(() => {
    refreshNewCount()
    refreshNewActorCount()
  }, [refreshNewCount, refreshNewActorCount])

  useEffect(() => {
    let mounted = true
    window.api.getActorBadgeDefinitions({ includeInactive: false })
      .then((rows) => {
        if (mounted) setActorBadgeDefinitions(rows || [])
      })
      .catch(() => {})
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const handleAiChatSelection = (event) => {
      const rawIds = Array.isArray(event?.detail?.videoIds) ? event.detail.videoIds : []
      const selectedIds = rawIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)

      setAppTab('library')
      setSelectedSubtitleDateKey(null)
      changeFolder(null)
      setCheckedIds(new Set(selectedIds))

      if (selectedIds.length > 0) {
        const first = videos.find((video) => selectedIds.includes(Number(video.id)))
        if (first) setSelectedVideo(first)
      }
    }

    window.addEventListener('ai-chat:select-videos', handleAiChatSelection)
    return () => window.removeEventListener('ai-chat:select-videos', handleAiChatSelection)
  }, [changeFolder, videos])

  useEffect(() => {
    const handleAiChatFilterVideos = (event) => {
      const rawIds = Array.isArray(event?.detail?.videoIds) ? event.detail.videoIds : []
      const ids = Array.from(new Set(rawIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
      ))
      const label = String(event?.detail?.label || '작업 결과')

      setAppTab('library')
      setSelectedSubtitleDateKey(null)
      changeTab('all')
      changeFolder(null)
      changeFilters({ baseResultIds: ids })
      setCheckedIds(new Set())

      if (ids.length > 0) {
        setAiResultFilterMeta({ count: ids.length, label })
      } else {
        setAiResultFilterMeta(null)
      }
    }

    window.addEventListener('ai-chat:filter-videos', handleAiChatFilterVideos)
    return () => window.removeEventListener('ai-chat:filter-videos', handleAiChatFilterVideos)
  }, [changeFilters, changeFolder, changeTab])

  const handleClearAiResultFilter = useCallback(() => {
    changeFilters({ baseResultIds: [] })
    setAiResultFilterMeta(null)
  }, [changeFilters])

  // ── 드라이브 연결 상태 모니터링 ───────────────────────────────
  useEffect(() => {
    // 드라이브 연결 끊김 이벤트 수신
    const unsubscribeDisconnect = window.api.onDriveDisconnected((payload) => {
      const shortPath = payload.path.split(/[/\\]/).pop()
      const alertId = `disconnect-${payload.path}`
      setDriveAlerts((prev) => [
        ...prev.filter((a) => a.id !== alertId), // 같은 경로의 이전 알림 제거
        { 
          id: alertId, 
          type: 'error', 
          title: '⚠️ 외장하드 연결 끊김',
          message: `폴더 "${shortPath}" (${payload.path})에 접근할 수 없습니다.`,
          path: payload.path,
          timestamp: payload.timestamp,
        },
      ])
      // 10초 후 자동 제거
      setTimeout(() => {
        setDriveAlerts((prev) => prev.filter((a) => a.id !== alertId))
      }, 10000)
    })

    // 드라이브 재연결 이벤트 수신
    const unsubscribeReconnect = window.api.onDriveReconnected((payload) => {
      const shortPath = payload.path.split(/[/\\]/).pop()
      const alertId = `reconnect-${payload.path}`
      setDriveAlerts((prev) => [
        ...prev.filter((a) => a.id !== alertId),
        { 
          id: alertId, 
          type: 'success', 
          title: '✓ 외장하드 재연결',
          message: `폴더 "${shortPath}"이(가) 다시 연결되었습니다.`,
          path: payload.path,
          timestamp: new Date().toISOString(),
        },
      ])
      // 5초 후 자동 제거
      setTimeout(() => {
        setDriveAlerts((prev) => prev.filter((a) => a.id !== alertId))
      }, 5000)
    })

    return () => {
      unsubscribeDisconnect()
      unsubscribeReconnect()
    }
  }, [])

  const activeVideos = useMemo(() => {
    if (!selectedSubtitleDateKey) return videos
    return videos.filter((video) => getLocalDateKey(video.subtitle_added_at) === selectedSubtitleDateKey)
  }, [videos, selectedSubtitleDateKey])

  const visibleSelectedVideo = useMemo(() => {
    if (!selectedSubtitleDateKey) return selectedVideo
    if (selectedVideo && activeVideos.some((video) => video.id === selectedVideo.id)) {
      return selectedVideo
    }
    return activeVideos[0] || null
  }, [activeVideos, selectedSubtitleDateKey, selectedVideo])

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
        await refreshNewActorCount()
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
      await refreshNewActorCount()
      setFolderRefreshKey((k) => k + 1)
      changeFolder(result.scannedFolder)
      setScanInfo({ ...result, newAdded: Math.max(0, nextNew - prevNew) })
    } catch (e) { setError('스캔 중 오류: ' + e.message) }
    finally { setScanning(false) }
  }

  // ── 랜덤 추천 ─────────────────────────────────────────────────
  const handleRandomPick = async () => {
    try {
      const result = await window.api.randomPick(searchQuery, {
        hideMissing: filters.excludeMissing,
        currentFolder,
        actorTierFilter: filters.actorTierFilter,
        actorBadgeFilter: filters.actorBadgeFilter,
      })
      setRandomResult(result)
    } catch (e) { setError('랜덤 추천 실패: ' + e.message) }
  }

  // ── 배우별 1개 추출 ───────────────────────────────────────────
  const handleActorPick = async () => {
    setActorPicking(true)
    try {
      const result = await window.api.pickOnePerActor(searchQuery, {
        hideMissing: filters.excludeMissing,
        currentFolder,
        actorTierFilter: filters.actorTierFilter,
        actorBadgeFilter: filters.actorBadgeFilter,
      })
      setActorPickResult(result)
    } catch (e) { setError('배우별 추출 실패: ' + e.message) }
    finally { setActorPicking(false) }
  }

  // ── 파일 복사 모달 ────────────────────────────────────────────
  const handleOpenFileCopy = useCallback(() => setShowFileCopyModal(true), [])

  // ── 폴더 활성화/비활성화 토글 ───────────────────────────────
  const handleToggleFolderActive = useCallback(async (folderPath) => {
    try {
      const result = await window.api.toggleFolderActive(folderPath)
      if (result.success) {
        // 검색 결과 갱신 (비활성화 폴더 파일 제외)
        await refresh()
        // 폴더 목록 새로고침
        setFolderRefreshKey((k) => k + 1)
      } else {
        setError('폴더 활성화 상태 변경 실패: ' + result.error)
      }
    } catch (err) {
      setError('폴더 활성화 상태 변경 중 오류: ' + err.message)
    }
  }, [refresh])

  // ── 파일 복사 모달 ────────────────────────────────────────────

  // ── 체크박스 ──────────────────────────────────────────────────
  const handleToggleCheck = useCallback((_e, id) => {
    setCheckedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }, [])
  const handleToggleAll = useCallback((checkAll) => {
    setCheckedIds(checkAll ? new Set(activeVideos.map((v) => v.id)) : new Set())
  }, [activeVideos])

  const handleSelectSubtitleDate = useCallback((dateKey) => {
    setSelectedSubtitleDateKey((prev) => (prev === dateKey ? null : dateKey))
    setCheckedIds(new Set())
  }, [])

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
  const subtitleSelectionLabel = selectedSubtitleDateKey
    ? `${Number(selectedSubtitleDateKey.slice(5, 7))}.${Number(selectedSubtitleDateKey.slice(8, 10))}`
    : null

  const aiChatContext = useMemo(() => {
    const pageHasFolderContext = appTab === 'library'
    const normalizedFolder = pageHasFolderContext && typeof currentFolder === 'string' && currentFolder.trim()
      ? currentFolder.trim()
      : null
    const currentDrive = extractDrive(normalizedFolder)

    return {
      currentPage: appTab,
      currentFolder: normalizedFolder,
      currentDrive,
      selectedVideoIds: Array.from(checkedIds),
      activeFilters: {
        tabMode,
        folder: normalizedFolder,
        drive: currentDrive,
        excludeMissing: Boolean(filters.excludeMissing),
        excludeDeleteGrade: Boolean(filters.excludeDeleteGrade),
        recommendedOnly: Boolean(filters.recommendedOnly),
        minRating: Number(filters.minRating) || 0,
        subtitleAddedDays: Number(filters.subtitleAddedDays) || 0,
      },
    }
  }, [appTab, checkedIds, currentFolder, filters.excludeDeleteGrade, filters.excludeMissing, filters.minRating, filters.recommendedOnly, filters.subtitleAddedDays, tabMode])

  return (
    <AiChatProvider currentContext={aiChatContext}>
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
            { key: 'actors',          label: newActorCount > 0 ? `배우 관리 (${newActorCount})` : '배우 관리' },
            { key: 'actor-tags',      label: '배우 태그 일괄 관리' },
            { key: 'subtitles',       label: '자막 보관소' },
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
          videos={activeVideos}
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

      {/* ── 배우 태그 일괄 관리 탭 ────────────────────────── */}
        {appTab === 'actor-tags' && <ActorTagBatchPage />}

      {/* ── 자막 보관소 탭 ───────────────────────────────── */}
        {appTab === 'subtitles' && <SubtitlesPage />}

      {/* ── 추천·탐색 탭 ─────────────────────────────────── */}
      {/* display:none 방식으로 유지 — 탭 이동 시 AI 결과 state 보존 */}
        <div style={{ display: appTab === 'recommendations' ? 'flex' : 'none', flex: 1, flexDirection: 'column', minHeight: 0 }}>
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
            totalCount={activeVideos.length}
            totalSize={activeVideos.reduce((s, v) => s + (v.size || 0), 0)}
            badgeDefinitions={actorBadgeDefinitions}
          />
          <div className="subtitle-date-toggle-bar">
            <button
              type="button"
              className="subtitle-date-toggle-btn"
              onClick={() => setShowSubtitleDateModal(true)}
            >
              자막 날짜 팝업 열기
            </button>
            {selectedSubtitleDateKey && (
              <span className="subtitle-date-toggle-label">
                선택됨: {subtitleSelectionLabel}
              </span>
            )}
          </div>
          <Modal
            open={showSubtitleDateModal}
            onCancel={() => setShowSubtitleDateModal(false)}
            footer={null}
            width={1120}
            title="자막 수정일"
            destroyOnClose={false}
            centered
            className="subtitle-date-modal"
          >
            <SubtitleDatePanel
              videos={videos}
              selectedDateKey={selectedSubtitleDateKey}
              onSelectDate={handleSelectSubtitleDate}
            />
          </Modal>
          <div className="view-indicator">
            <span className="view-indicator-label">현재 보기</span>
            <span
              className="view-indicator-path"
              title={subtitleSelectionLabel ? `${viewLabel} · 자막 ${subtitleSelectionLabel}` : viewLabel}
            >
              {subtitleSelectionLabel ? `${viewLabel} · 자막 ${subtitleSelectionLabel}` : viewLabel}
            </span>
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
                  {(scanInfo.newActors ?? 0) > 0 && (
                    <span style={{ color: '#22c55e', marginLeft: 8 }}>
                      · 새 배우 <strong>{scanInfo.newActors}</strong>명 발견
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

          {/* 드라이브 연결 상태 알림 */}
          {driveAlerts.map((alert) => (
            <Alert
              key={alert.id}
              type={alert.type}
              showIcon
              closable
              onClose={() => setDriveAlerts((prev) => prev.filter((a) => a.id !== alert.id))}
              message={alert.title}
              description={alert.message}
              style={{ borderRadius: 0, flexShrink: 0 }}
            />
          ))}

          {Array.isArray(filters.baseResultIds) && filters.baseResultIds.length > 0 && (
            <Alert
              type="info"
              showIcon
              closable
              onClose={handleClearAiResultFilter}
              message={`작업 결과 필터 적용 중 · ${filters.baseResultIds.length}개`}
              description={aiResultFilterMeta?.label ? `${aiResultFilterMeta.label} 기준으로 영상 목록을 필터링했습니다.` : '작업 결과 기준으로 영상 목록을 필터링했습니다.'}
              action={(
                <button
                  type="button"
                  className="app-tab-btn"
                  onClick={handleClearAiResultFilter}
                >
                  필터 해제
                </button>
              )}
              style={{ borderRadius: 0, flexShrink: 0 }}
            />
          )}

          <div className="app-content">
            <FolderPanel
              currentFolder={currentFolder}
              onSelectFolder={changeFolder}
              onToggleFolderActive={handleToggleFolderActive}
              refreshKey={folderRefreshKey}
            />
            <VideoList
              videos={activeVideos}
              selectedId={visibleSelectedVideo?.id}
              onSelect={setSelectedVideo}
              loading={loading}
              checkedIds={checkedIds}
              onToggleCheck={handleToggleCheck}
              onToggleAll={handleToggleAll}
            />
            <div className="detail-panel-wrap">
              {visibleSelectedVideo ? (
                <DetailPanel
                  video={visibleSelectedVideo}
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
          videos={activeVideos}
          selectedIds={checkedIds}
          onClose={() => { setShowFileCopyModal(false); setCheckedIds(new Set()) }}
        />
      )}
        <AiChatLauncher />
        <AiChatDrawer />
        <AiChatFullscreen />
      </div>
    </AiChatProvider>
  )
}


