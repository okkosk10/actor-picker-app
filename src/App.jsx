import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'

// ──────────────────────────────────────────────────────────────
// 유틸리티 함수
// ──────────────────────────────────────────────────────────────

/** 바이트 단위 파일 크기를 사람이 읽기 쉬운 형태로 변환 */
function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '-'
  if (bytes < 1024)                  return bytes + ' B'
  if (bytes < 1024 * 1024)           return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024)   return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

/** ISO 날짜 문자열을 한국어 날짜 형식으로 변환 */
function formatDate(isoStr) {
  if (!isoStr) return '-'
  return new Date(isoStr).toLocaleDateString('ko-KR')
}

/** 상태(status) 값에 대응하는 한글 레이블 반환 */
const STATUS_LABELS = {
  normal:   '일반',
  watched:  '시청완료',
  favorite: '즐겨찾기',
  later:    '나중에',
}

// ──────────────────────────────────────────────────────────────
// StarRating 컴포넌트
// readOnly=true 이면 표시만, false 이면 클릭으로 변경 가능
// ──────────────────────────────────────────────────────────────
function StarRating({ value = 0, onChange, readOnly = false }) {
  const [hovered, setHovered] = useState(0)
  const active = hovered || value

  return (
    <div className={`star-rating${readOnly ? ' star-rating--readonly' : ''}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star${n <= active ? ' star--on' : ''}`}
          onClick={() => !readOnly && onChange && onChange(n === value ? 0 : n)}
          onMouseEnter={() => !readOnly && setHovered(n)}
          onMouseLeave={() => !readOnly && setHovered(0)}
          disabled={readOnly}
          aria-label={`${n}점`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// VideoItem 컴포넌트 - 목록에서 각 동영상 항목을 표시
// ──────────────────────────────────────────────────────────────
function VideoItem({ video, selected, onClick }) {
  // 상태별 색상 클래스
  const statusClass = video.status && video.status !== 'normal'
    ? ` video-item--${video.status}`
    : ''

  return (
    <div
      className={`video-item${selected ? ' video-item--selected' : ''}${statusClass}`}
      onClick={() => onClick(video)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(video)}
    >
      {/* 상단: 품번 + 배우명 + 별점 */}
      <div className="vi-header">
        <div className="vi-header-left">
          {video.code
            ? <span className="code-badge">{video.code}</span>
            : <span className="code-badge code-badge--empty">-</span>
          }
          <span className="actor-name">
            {video.actor_name || '(배우 미상)'}
          </span>
        </div>
        <StarRating value={video.rating || 0} readOnly />
      </div>

      {/* 파일명 */}
      <div className="vi-filename">{video.file_name}</div>

      {/* 하단: 폴더명 + 상태 뱃지 */}
      <div className="vi-footer">
        <span className="vi-folder" title={video.folder_path}>
          📁 {video.folder_path.split(/[\\/]/).pop()}
        </span>
        {video.status && video.status !== 'normal' && (
          <span className={`status-badge status-badge--${video.status}`}>
            {STATUS_LABELS[video.status] || video.status}
          </span>
        )}
      </div>

      {/* 메모 미리보기 */}
      {video.memo && (
        <div className="vi-memo">{video.memo}</div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// DetailPanel 컴포넌트 - 선택한 동영상의 상세 정보 및 편집
// ──────────────────────────────────────────────────────────────
function DetailPanel({ video, onUpdate, onOpenVideo, onOpenFolder }) {
  // 편집 필드 로컬 상태
  const [memo,   setMemo]   = useState(video.memo   || '')
  const [tags,   setTags]   = useState(video.tags   || '')
  const [rating, setRating] = useState(video.rating || 0)
  const [status, setStatus] = useState(video.status || 'normal')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  // 다른 동영상 선택 시 편집 상태를 새 동영상 데이터로 초기화
  useEffect(() => {
    setMemo(video.memo   || '')
    setTags(video.tags   || '')
    setRating(video.rating || 0)
    setStatus(video.status || 'normal')
    setSaved(false)
  }, [video.id])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onUpdate(video.id, { memo, tags, rating, status })
      setSaved(true)
      // 2초 후 저장 완료 표시 숨김
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert('저장 실패: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="detail-content">
      {/* 파일명 헤더 */}
      <h2 className="detail-filename" title={video.file_name}>
        {video.file_name}
      </h2>

      {/* 파일 정보 (읽기 전용) */}
      <div className="detail-meta">
        <div className="meta-row">
          <span className="meta-label">품번</span>
          <span className="meta-value">{video.code || '-'}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">배우</span>
          <span className="meta-value">{video.actor_name || '-'}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">폴더</span>
          <span className="meta-value meta-path" title={video.folder_path}>
            {video.folder_path}
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-label">크기</span>
          <span className="meta-value">{formatFileSize(video.size)}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">수정일</span>
          <span className="meta-value">{formatDate(video.modified_at)}</span>
        </div>
      </div>

      {/* 편집 섹션 */}
      <div className="detail-edit">
        <div className="edit-field">
          <label className="edit-label">별점</label>
          <StarRating value={rating} onChange={setRating} />
        </div>

        <div className="edit-field">
          <label className="edit-label" htmlFor="dp-status">상태</label>
          <select
            id="dp-status"
            className="edit-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="normal">일반</option>
            <option value="watched">시청완료</option>
            <option value="favorite">즐겨찾기</option>
            <option value="later">나중에</option>
          </select>
        </div>

        <div className="edit-field">
          <label className="edit-label" htmlFor="dp-tags">태그</label>
          <input
            id="dp-tags"
            type="text"
            className="edit-input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="쉼표로 구분 (예: 4K, 자막, HD)"
          />
        </div>

        <div className="edit-field">
          <label className="edit-label" htmlFor="dp-memo">메모</label>
          <textarea
            id="dp-memo"
            className="edit-textarea"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모를 입력하세요..."
            rows={4}
          />
        </div>

        <button
          className="btn-save"
          type="button"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '저장 중…' : saved ? '✓ 저장됨' : '저장'}
        </button>
      </div>

      {/* 파일/폴더 열기 버튼 */}
      <div className="detail-actions">
        <button
          className="btn-action"
          type="button"
          onClick={() => onOpenVideo(video.file_path)}
        >
          ▶ 파일 열기
        </button>
        <button
          className="btn-action btn-action--secondary"
          type="button"
          onClick={() => onOpenFolder(video.folder_path)}
        >
          📁 폴더 열기
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// RandomModal 컴포넌트 - 랜덤 추천 결과 모달
// ──────────────────────────────────────────────────────────────
function RandomModal({ result, onClose, onCopy }) {
  // 모달 외부 클릭 시 닫기
  const overlayRef = useRef(null)

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="modal" role="dialog" aria-modal="true">
        {/* 모달 헤더 */}
        <div className="modal-header">
          <h2 className="modal-title">🎲 랜덤 추천</h2>
          <button className="modal-close" type="button" onClick={onClose}>✕</button>
        </div>

        {/* 통계 */}
        <div className="modal-stats">
          <span className="stat-item">영상 <strong>{result.totalFiles}</strong>개</span>
          <span className="stat-sep">·</span>
          <span className="stat-item">배우 <strong>{result.actorCount}</strong>명</span>
          <span className="stat-sep">·</span>
          <span className="stat-item">선택 <strong>{result.pickedCount}</strong>개</span>
        </div>

        {/* OR 검색식 */}
        {result.searchText && (
          <div className="modal-searchbox">
            <div className="modal-searchbox-header">
              <span className="modal-searchbox-label">OR 검색식</span>
              <button className="btn-copy" type="button" onClick={onCopy}>
                복사
              </button>
            </div>
            <textarea
              className="modal-textarea"
              readOnly
              value={result.searchText}
              rows={3}
            />
          </div>
        )}

        {/* 선택된 목록 */}
        <div className="modal-list-wrap">
          {result.pickedList.length === 0 ? (
            <p className="modal-empty">결과가 없습니다.</p>
          ) : (
            <table className="picked-table">
              <thead>
                <tr>
                  <th>배우</th>
                  <th>품번</th>
                  <th>파일명</th>
                </tr>
              </thead>
              <tbody>
                {result.pickedList.map((item) => (
                  <tr key={item.id}>
                    <td>{item.actor_name || '-'}</td>
                    <td><code className="code-cell">{item.code || '-'}</code></td>
                    <td className="td-filename">{item.file_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// App 컴포넌트 - 최상위 컴포넌트
// ──────────────────────────────────────────────────────────────
function App() {
  const [folderPath,     setFolderPath]     = useState(null)
  const [videos,         setVideos]         = useState([])
  const [selectedVideo,  setSelectedVideo]  = useState(null)
  const [searchQuery,    setSearchQuery]    = useState('')
  const [scanning,       setScanning]       = useState(false)
  const [error,          setError]          = useState(null)
  const [randomResult,   setRandomResult]   = useState(null)
  const [scanInfo,       setScanInfo]       = useState(null)   // 마지막 스캔 결과

  // ── 초기 로드: 앱 시작 시 DB에 저장된 전체 영상 조회 ──────────
  useEffect(() => {
    loadVideos('')
  }, [])

  /** DB에서 영상 목록을 검색하여 상태 업데이트 */
  const loadVideos = useCallback(async (query) => {
    try {
      const result = await window.api.searchVideos(query)
      setVideos(result)
    } catch (e) {
      setError('영상 목록 로드 실패: ' + e.message)
    }
  }, [])

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
    if (!folderPath) {
      setError('먼저 폴더를 선택해주세요.')
      return
    }
    setError(null)
    setScanning(true)
    try {
      const result = await window.api.scanFolder(folderPath)
      setScanInfo(result)
      // 스캔 후 현재 검색 조건 유지하면서 목록 갱신
      await loadVideos(searchQuery)
    } catch (e) {
      setError('스캔 중 오류: ' + e.message)
    } finally {
      setScanning(false)
    }
  }

  // ── 검색 입력 ─────────────────────────────────────────────────
  const handleSearch = (e) => {
    const q = e.target.value
    setSearchQuery(q)
    loadVideos(q)
  }

  // ── 영상 선택 ─────────────────────────────────────────────────
  const handleSelectVideo = (video) => {
    setSelectedVideo(video)
  }

  // ── 메타 업데이트 ─────────────────────────────────────────────
  const handleUpdate = async (id, data) => {
    const updated = await window.api.updateVideoMeta(id, data)
    // 목록과 상세 패널 모두 업데이트
    setVideos((prev) => prev.map((v) => (v.id === id ? updated : v)))
    setSelectedVideo(updated)
    return updated
  }

  // ── 랜덤 추천 ─────────────────────────────────────────────────
  const handleRandomPick = async () => {
    try {
      const result = await window.api.randomPick(searchQuery)
      setRandomResult(result)
    } catch (e) {
      setError('랜덤 추천 실패: ' + e.message)
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 렌더링
  // ──────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* ── 헤더 ─────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-brand">
          <h1 className="app-title">Actor Picker</h1>
        </div>

        <div className="header-actions">
          {/* 폴더 선택 */}
          <button className="btn-primary" type="button" onClick={handleSelectFolder}>
            폴더 선택
          </button>

          {/* 선택된 폴더 경로 표시 */}
          {folderPath && (
            <span className="header-path" title={folderPath}>
              {folderPath}
            </span>
          )}

          {/* 스캔 버튼 */}
          <button
            className="btn-secondary"
            type="button"
            onClick={handleScan}
            disabled={!folderPath || scanning}
          >
            {scanning ? '스캔 중…' : '스캔'}
          </button>

          {/* 랜덤 추천 버튼 */}
          <button
            className="btn-random"
            type="button"
            onClick={handleRandomPick}
            disabled={videos.length === 0}
          >
            🎲 랜덤 추천
          </button>
        </div>
      </header>

      {/* ── 검색 바 ───────────────────────────────────────────── */}
      <div className="search-bar">
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-input"
            placeholder="파일명, 품번, 배우명, 메모, 태그 검색..."
            value={searchQuery}
            onChange={handleSearch}
          />
          {searchQuery && (
            <button
              className="search-clear"
              type="button"
              onClick={() => { setSearchQuery(''); loadVideos('') }}
            >
              ✕
            </button>
          )}
        </div>
        <span className="search-count">{videos.length}개</span>
      </div>

      {/* ── 스캔 결과 알림 ────────────────────────────────────── */}
      {scanInfo && (
        <div className="scan-info">
          ✓ 스캔 완료 — <strong>{scanInfo.totalFiles}</strong>개 파일 처리됨
        </div>
      )}

      {/* ── 에러 메시지 ───────────────────────────────────────── */}
      {error && (
        <div className="error-msg">
          {error}
          <button className="error-close" type="button" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ── 메인 콘텐츠 ──────────────────────────────────────── */}
      <div className="app-content">

        {/* 동영상 목록 (좌측) */}
        <div className="video-list">
          {videos.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🎬</div>
              <p>동영상이 없습니다.</p>
              <p className="empty-hint">폴더를 선택하고 스캔하세요.</p>
            </div>
          ) : (
            videos.map((v) => (
              <VideoItem
                key={v.id}
                video={v}
                selected={selectedVideo?.id === v.id}
                onClick={handleSelectVideo}
              />
            ))
          )}
        </div>

        {/* 상세 패널 (우측) */}
        <div className="detail-panel">
          {selectedVideo ? (
            <DetailPanel
              video={selectedVideo}
              onUpdate={handleUpdate}
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

      {/* ── 랜덤 추천 모달 ────────────────────────────────────── */}
      {randomResult && (
        <RandomModal
          result={randomResult}
          onClose={() => setRandomResult(null)}
          onCopy={() => navigator.clipboard.writeText(randomResult.searchText)}
        />
      )}
    </div>
  )
}

export default App

