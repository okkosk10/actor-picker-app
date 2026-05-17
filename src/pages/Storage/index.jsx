/**
 * src/pages/Storage/index.jsx
 * 드라이브별 저장소 관리 페이지
 *
 * - 드라이브별 영상 수 / 용량 / 평균 별점 / 삭제 후보 수 카드 표시
 * - "삭제 후보 보기" 버튼 → 해당 드라이브 삭제 후보 리스트 열기
 * - 삭제 후보 리스트: 점수·이유·파일 위치 열기·삭제 예정 표시
 * - 실제 파일 삭제 없음 — grade='삭제요망' 표시만
 */
import { useState, useEffect, useCallback } from 'react'
import './Storage.css'

// ── 포맷 유틸 ───────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

function ratingStars(rating) {
  if (!rating || rating === 0) return null
  return '★'.repeat(rating) + '☆'.repeat(5 - rating)
}

function scoreClass(score) {
  if (score >= 60) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

// ── 드라이브 카드 ────────────────────────────────────────────
function DriveCard({ stat, isActive, onViewCandidates }) {
  return (
    <div
      className={`storage-drive-card ${isActive ? 'active' : ''}`}
      onClick={onViewCandidates}
    >
      <div className="storage-drive-card-header">
        <span className="storage-drive-icon">💾</span>
        <span className="storage-drive-label">{stat.drive}</span>
      </div>

      <div className="storage-drive-stats">
        <div className="storage-stat-item">
          <span className="storage-stat-label">영상 수</span>
          <span className="storage-stat-value">{stat.totalVideos.toLocaleString()}개</span>
        </div>
        <div className="storage-stat-item">
          <span className="storage-stat-label">사용 용량</span>
          <span className="storage-stat-value">{formatBytes(stat.totalSize)}</span>
        </div>
        <div className="storage-stat-item">
          <span className="storage-stat-label">평균 별점</span>
          <span className="storage-stat-value">
            {stat.averageRating > 0 ? `${stat.averageRating}점` : '—'}
          </span>
        </div>
        <div className="storage-stat-item">
          <span className="storage-stat-label">추천작</span>
          <span className="storage-stat-value">{stat.recommendedCount.toLocaleString()}개</span>
        </div>
        <div className="storage-stat-item">
          <span className="storage-stat-label">삭제 후보</span>
          <span className={`storage-stat-value ${stat.deleteCandidateCount > 0 ? 'danger' : ''}`}>
            {stat.deleteCandidateCount.toLocaleString()}개
          </span>
        </div>
        <div className="storage-stat-item">
          <span className="storage-stat-label">저선호도</span>
          <span className={`storage-stat-value ${stat.lowPreferenceCount > 10 ? 'warn' : ''}`}>
            {stat.lowPreferenceCount.toLocaleString()}개
          </span>
        </div>
      </div>

      <div className="storage-drive-actions">
        <button
          className="storage-view-candidates-btn"
          onClick={(e) => { e.stopPropagation(); onViewCandidates() }}
        >
          {isActive ? '▶ 후보 표시 중' : '삭제 후보 보기'}
        </button>
      </div>
    </div>
  )
}

// ── 삭제 후보 아이템 ─────────────────────────────────────────
function CandidateItem({ item, onOpenFolder, onMarkDelete, marked }) {
  const DELETE_TAGS = new Set(['삭제요망', '삭제 요망'])
  const isHighScore = item.deleteScore >= 60

  return (
    <div className="storage-candidate-item">
      {/* 점수 뱃지 */}
      <div className="storage-candidate-score">
        <span className={`storage-score-badge ${scoreClass(item.deleteScore)}`}>
          {item.deleteScore}
        </span>
        <span className="storage-score-label">점</span>
      </div>

      {/* 정보 */}
      <div className="storage-candidate-info">
        <div className="storage-candidate-filename" title={item.file_path}>
          {item.filename}
        </div>

        <div className="storage-candidate-meta">
          {/* 별점 */}
          <span className={`storage-rating ${!item.rating ? 'none' : ''}`}>
            {item.rating > 0 ? ratingStars(item.rating) : '별점 없음'}
          </span>
          <span className="meta-sep">·</span>

          {/* 배우 */}
          {item.actorNames.length > 0 && (
            <>
              <span className="storage-candidate-actors">
                {item.actorNames.join(', ')}
              </span>
              <span className="meta-sep">·</span>
            </>
          )}

          {/* 용량 */}
          <span>{formatBytes(item.file_size)}</span>
          <span className="meta-sep">·</span>

          {/* 사용 기록 */}
          <span>복사 {item.copy_count}회</span>
          <span className="meta-sep">·</span>
          <span>재생 {item.watch_count}회</span>
        </div>

        {/* 태그 */}
        {item.tags.length > 0 && (
          <div className="storage-candidate-tags">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className={`storage-candidate-tag ${DELETE_TAGS.has(tag) ? 'danger' : ''}`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* 삭제 이유 */}
        {item.reason.length > 0 && (
          <div className="storage-candidate-reasons">
            {item.reason.map((r, i) => (
              <span key={i} className="storage-reason-badge">{r}</span>
            ))}
          </div>
        )}
      </div>

      {/* 액션 버튼 */}
      <div className="storage-candidate-actions">
        <button
          className="storage-action-btn open-folder"
          onClick={() => onOpenFolder(item.file_path)}
          title="파일 위치 열기"
        >
          📂 위치 열기
        </button>

        {marked ? (
          <button className="storage-action-btn marked" disabled>
            ✓ 삭제 예정
          </button>
        ) : (
          <button
            className="storage-action-btn mark-delete"
            onClick={() => onMarkDelete(item.id)}
          >
            🗑 삭제 예정 표시
          </button>
        )}
      </div>
    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────
export default function StoragePage() {
  const [drives,          setDrives]          = useState([])
  const [loadingDrives,   setLoadingDrives]   = useState(false)
  const [activeDrive,     setActiveDrive]     = useState(null)   // "D:" | null
  const [candidates,      setCandidates]      = useState([])
  const [driveInfo,       setDriveInfo]       = useState(null)
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [markedIds,       setMarkedIds]       = useState(new Set())
  const [error,           setError]           = useState(null)

  // ── 드라이브 통계 로드 ───────────────────────────────────────
  const loadDriveStats = useCallback(async () => {
    setLoadingDrives(true)
    setError(null)
    try {
      const result = await window.api.getDriveStats()
      if (result.success) {
        setDrives(result.drives)
      } else {
        setError(result.error || '드라이브 통계 조회 실패')
      }
    } catch (err) {
      setError('드라이브 통계 조회 중 오류: ' + err.message)
    } finally {
      setLoadingDrives(false)
    }
  }, [])

  // 마운트 시 자동 로드
  useEffect(() => { loadDriveStats() }, [loadDriveStats])

  // ── 삭제 후보 로드 ───────────────────────────────────────────
  const loadCandidates = useCallback(async (drive) => {
    setLoadingCandidates(true)
    setCandidates([])
    setDriveInfo(null)
    try {
      const result = await window.api.getDeleteCandidatesByDrive(drive)
      if (result.success) {
        setCandidates(result.candidates)
        setDriveInfo({
          drive:         result.drive,
          freeSpace:     result.freeSpace,
          totalDiskSize: result.totalDiskSize,
          usedByLibrary: result.usedByLibrary,
        })
      } else {
        setError(result.error || '삭제 후보 조회 실패')
      }
    } catch (err) {
      setError('삭제 후보 조회 중 오류: ' + err.message)
    } finally {
      setLoadingCandidates(false)
    }
  }, [])

  const handleViewCandidates = useCallback((drive) => {
    if (activeDrive === drive) {
      // 같은 드라이브를 다시 누르면 패널 닫기
      setActiveDrive(null)
      setCandidates([])
      setDriveInfo(null)
      return
    }
    setActiveDrive(drive)
    loadCandidates(drive)
  }, [activeDrive, loadCandidates])

  // ── 파일 위치 열기 ───────────────────────────────────────────
  const handleOpenFolder = useCallback(async (filePath) => {
    try {
      const dir = filePath.replace(/[^\\/]+$/, '')
      await window.api.openFolder(dir)
    } catch { /* 무시 */ }
  }, [])

  // ── 삭제 예정 표시 ───────────────────────────────────────────
  const handleMarkDelete = useCallback(async (videoId) => {
    try {
      const result = await window.api.markDeleteCandidate(videoId)
      if (result.success) {
        setMarkedIds((prev) => new Set([...prev, videoId]))
        // 드라이브 통계 카운트 갱신 (비동기 조용히)
        loadDriveStats().catch(() => {})
      }
    } catch (err) {
      setError('표시 실패: ' + err.message)
    }
  }, [loadDriveStats])

  return (
    <div className="storage-page">
      {/* ── 헤더 ──────────────────────────────────────────── */}
      <div className="storage-header">
        <h2>💾 저장소 관리</h2>
        {driveInfo && activeDrive && (
          <span style={{ fontSize: 13, color: '#888' }}>
            {activeDrive} 라이브러리 사용: {formatBytes(driveInfo.usedByLibrary)}
          </span>
        )}
        <div className="storage-header-spacer" />
        <button
          className="storage-refresh-btn"
          onClick={loadDriveStats}
          disabled={loadingDrives}
        >
          {loadingDrives ? '조회 중…' : '새로고침'}
        </button>
      </div>

      {/* ── 에러 ──────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '10px 20px', background: '#2a1010', color: '#f87171', fontSize: 13 }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: 12, background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── 드라이브 카드 ─────────────────────────────────── */}
      {loadingDrives ? (
        <div className="storage-loading">⏳ 드라이브 정보 수집 중…</div>
      ) : drives.length === 0 ? (
        <div className="storage-empty">
          <div className="storage-empty-icon">💾</div>
          <div className="storage-empty-text">등록된 영상이 없거나 드라이브 정보를 읽을 수 없습니다.</div>
        </div>
      ) : (
        <div className="storage-drive-grid">
          {drives.map((stat) => (
            <DriveCard
              key={stat.drive}
              stat={stat}
              isActive={activeDrive === stat.drive}
              onViewCandidates={() => handleViewCandidates(stat.drive)}
            />
          ))}
        </div>
      )}

      {/* ── 삭제 후보 패널 ───────────────────────────────── */}
      {activeDrive && (
        <div className="storage-candidates-panel">
          <div className="storage-candidates-header">
            <span className="storage-candidates-title">
              🗑 {activeDrive} 삭제 후보
            </span>
            {!loadingCandidates && (
              <span className="storage-candidates-count">
                {candidates.length}개
              </span>
            )}

            {/* 디스크 정보 */}
            {driveInfo && (
              <div className="storage-disk-info">
                {driveInfo.usedByLibrary > 0 && (
                  <span>
                    <span style={{ fontSize: 11 }}>라이브러리 사용</span>
                    <strong>{formatBytes(driveInfo.usedByLibrary)}</strong>
                  </span>
                )}
                {driveInfo.freeSpace > 0 && (
                  <span>
                    <span style={{ fontSize: 11 }}>여유 공간</span>
                    <strong>{formatBytes(driveInfo.freeSpace)}</strong>
                  </span>
                )}
              </div>
            )}

            <button
              className="storage-candidates-close"
              onClick={() => {
                setActiveDrive(null)
                setCandidates([])
                setDriveInfo(null)
              }}
            >
              ✕
            </button>
          </div>

          {loadingCandidates ? (
            <div className="storage-loading">⏳ 삭제 후보 분석 중…</div>
          ) : candidates.length === 0 ? (
            <div className="storage-empty">
              <div className="storage-empty-icon">✅</div>
              <div className="storage-empty-text">삭제 후보가 없습니다. 라이브러리 상태가 양호합니다.</div>
            </div>
          ) : (
            <>
              {/* 안내 메시지 */}
              <div style={{
                padding: '8px 20px',
                background: '#1a1a10',
                borderBottom: '1px solid #2a2a1a',
                fontSize: 12,
                color: '#888',
                flexShrink: 0,
              }}>
                ⚠️ "삭제 예정 표시"는 <strong style={{ color: '#fbbf24' }}>grade='삭제요망'</strong>으로 변경할 뿐, 실제 파일은 삭제하지 않습니다.
                파일 삭제는 <strong>영상 관리 → 삭제 정리</strong>에서 별도로 진행하세요.
              </div>

              <div className="storage-candidates-list">
                {candidates.map((item) => (
                  <CandidateItem
                    key={item.id}
                    item={item}
                    onOpenFolder={handleOpenFolder}
                    onMarkDelete={handleMarkDelete}
                    marked={markedIds.has(item.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
