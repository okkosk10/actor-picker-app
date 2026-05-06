/**
 * src/App.jsx
 * 최상위 컴포넌트 — 상태 연결과 레이아웃만 담당
 *
 * 레이아웃:
 *   header → SearchBar → (scan-info) → (error) → app-content[VideoList | DetailPanel]
 *   RandomPanel 모달 (필요 시)
 */
import { useState } from 'react'
import { Alert, message } from 'antd'
import './App.css'

import { useVideoSearch }    from './hooks/useVideoSearch.js'
import SearchBar             from './components/SearchBar.jsx'
import VideoList             from './components/VideoList.jsx'
import DetailPanel           from './components/DetailPanel.jsx'
import RandomPanel           from './components/RandomPanel.jsx'
import ActorPickPanel        from './components/ActorPickPanel.jsx'
import DeleteCleanupModal    from './components/DeleteCleanupModal.jsx'

export default function App() {
  // ── 동영상 목록 검색/정렬 상태 (hook) ─────────────────────────
  const {
    videos, setVideos,
    searchQuery, search,
    sortBy, changeSort,
    hideMissing, toggleHideMissing,
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
  const handleScan = async () => {
    if (!folderPath) { setError('먼저 폴더를 선택해주세요.'); return }
    setError(null)
    setScanning(true)
    try {
      const result = await window.api.scanFolder(folderPath)
      setScanInfo(result)
      refresh()
    } catch (e) {
      setError('스캔 중 오류: ' + e.message)
    } finally {
      setScanning(false)
    }
  }

  // ── 랜덤 추천 ─────────────────────────────────────────────────
  const handleRandomPick = async () => {
    try {
      const result = await window.api.randomPick(searchQuery, { hideMissing })
      setRandomResult(result)
    } catch (e) {
      setError('랜덤 추천 실패: ' + e.message)
    }
  }

  // ── 배우별 1개 추출 ───────────────────────────────────────────
  const handleActorPick = async () => {
    setActorPicking(true)
    try {
      const result = await window.api.pickOnePerActor(searchQuery, { hideMissing })
      setActorPickResult(result)
    } catch (e) {
      setError('배우별 추출 실패: ' + e.message)
    } finally {
      setActorPicking(false)
    }
  }

  // ── 검색 결과 OR문 복사 ────────────────────────────────────────
  const handleCopyOrText = async () => {
    const validVideos = videos.filter(
      (v) =>
        v.code &&
        v.status !== 'missing' &&
        v.status !== 'deleted' &&
        v.grade !== '삭제요망',
    )
    const codes = Array.from(new Set(validVideos.map((v) => v.code)))

    if (codes.length === 0) {
      message.warning('복사할 품번이 없습니다.')
      return
    }

    await navigator.clipboard.writeText(codes.join(' OR '))
    message.success(`${codes.length}개 품번 OR문을 복사했습니다.`)
  }

  // ── 메타 업데이트 동기화 ──────────────────────────────────────
  const handleVideoUpdated = (updated) => {
    setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)))
    setSelectedVideo(updated)
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
            disabled={!folderPath || scanning}
          >
            {scanning ? '스캔 중…' : '스캔'}
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

      {/* 검색 바 */}
      <SearchBar
        query={searchQuery}
        onQueryChange={search}
        sortBy={sortBy}
        onSortChange={changeSort}
        hideMissing={hideMissing}
        onHideMissing={toggleHideMissing}
        count={videos.length}
      />

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
              스캔 완료 — <strong>{scanInfo.totalFiles}</strong>개 처리
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

      {/* 메인 콘텐츠 (2컬럼) */}
      <div className="app-content">
        <VideoList
          videos={videos}
          selectedId={selectedVideo?.id}
          onSelect={setSelectedVideo}
          loading={loading}
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

      {/* 삭제요망 정리 모달 */}
      {showDeleteModal && (
        <DeleteCleanupModal
          onClose={() => setShowDeleteModal(false)}
          onDeleted={refresh}
        />
      )}
    </div>
  )
}
