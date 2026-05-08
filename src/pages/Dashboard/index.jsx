/**
 * src/pages/Dashboard/index.jsx
 * 대시보드 페이지
 *
 * - useRef loading guard: StrictMode의 useEffect 2회 실행에서도 IPC 1번만 호출
 * - console.time으로 IPC 호출 전후 시간 측정
 * - 무거운 섹션(tagStats, topActors, recentActivities)은 상위 10~20개만 렌더링
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import './Dashboard.css'

// ── 포맷 헬퍼 ────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`
}

function formatDate(str) {
  if (!str) return '—'
  return str.slice(0, 16).replace('T', ' ')
}

const ACTION_LABEL = {
  open:              '재생',
  copy_to_clipboard: '클립보드 복사',
  copy_to_device:    '장치 복사',
}

// ── 섹션 컴포넌트 ─────────────────────────────────────────────────

function SummaryCards({ summary }) {
  const cards = [
    { label: '전체 영상',   value: summary.totalVideos.toLocaleString() + '개' },
    { label: '등록 배우',   value: summary.totalActors.toLocaleString() + '명' },
    { label: '전체 용량',   value: formatBytes(summary.totalSize) },
    { label: '평균 별점',   value: summary.averageRating ? `${summary.averageRating}점` : '—' },
    { label: 'NEW 대기',    value: summary.newCount.toLocaleString() + '개' },
    { label: '즐겨찾기',    value: summary.favoriteCount.toLocaleString() + '개' },
    { label: '시청한 영상', value: summary.watchedCount.toLocaleString() + '개' },
  ]
  return (
    <div className="dash-cards">
      {cards.map(({ label, value }) => (
        <div key={label} className="dash-card">
          <div className="dash-card-label">{label}</div>
          <div className="dash-card-value">{value}</div>
        </div>
      ))}
    </div>
  )
}

function RatingDistribution({ data }) {
  const max = Math.max(...data.map((r) => r.count), 1)
  return (
    <div className="dash-section">
      <h3 className="dash-section-title">별점 분포</h3>
      <div className="dash-rating-bars">
        {data.map(({ rating, count }) => (
          <div key={rating} className="dash-rating-row">
            <span className="dash-rating-label">{'★'.repeat(rating) || '없음'}</span>
            <div className="dash-bar-wrap">
              <div
                className="dash-bar"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="dash-rating-count">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TopActors({ actors }) {
  // 상위 10명만 렌더링
  const visible = useMemo(() => actors.slice(0, 10), [actors])
  return (
    <div className="dash-section">
      <h3 className="dash-section-title">인기 배우 TOP 10</h3>
      <table className="dash-table">
        <thead>
          <tr>
            <th>#</th>
            <th>배우</th>
            <th>영상 수</th>
            <th>평균 별점</th>
            <th>재생 수</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((a, i) => (
            <tr key={a.actorId}>
              <td className="dash-td-rank">{i + 1}</td>
              <td>{a.actorName}</td>
              <td>{a.videoCount}</td>
              <td>{a.averageRating ?? '—'}</td>
              <td>{a.playCount}</td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr><td colSpan={5} className="dash-td-empty">데이터 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function RecentVideos({ videos }) {
  return (
    <div className="dash-section">
      <h3 className="dash-section-title">최근 수정 영상</h3>
      <table className="dash-table">
        <thead>
          <tr>
            <th>파일명</th>
            <th>배우</th>
            <th>별점</th>
            <th>등급</th>
            <th>마지막 재생</th>
            <th>수정일</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr key={v.id}>
              <td className="dash-td-filename" title={v.file_name}>{v.file_name}</td>
              <td>{v.actor_name || '—'}</td>
              <td>{'★'.repeat(v.rating || 0) || '—'}</td>
              <td>{v.grade || '—'}</td>
              <td>{formatDate(v.last_played_at)}</td>
              <td>{formatDate(v.updated_at)}</td>
            </tr>
          ))}
          {videos.length === 0 && (
            <tr><td colSpan={6} className="dash-td-empty">데이터 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function RecentActivities({ activities }) {
  // 상위 10개만 렌더링
  const visible = useMemo(() => activities.slice(0, 10), [activities])
  return (
    <div className="dash-section">
      <h3 className="dash-section-title">최근 활동</h3>
      <table className="dash-table">
        <thead>
          <tr>
            <th>액션</th>
            <th>파일명</th>
            <th>배우</th>
            <th>시각</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((a) => (
            <tr key={a.id}>
              <td><span className="dash-action-badge">{ACTION_LABEL[a.actionType] ?? a.actionType}</span></td>
              <td className="dash-td-filename" title={a.fileName}>{a.fileName || '—'}</td>
              <td>{a.actorName || '—'}</td>
              <td>{formatDate(a.createdAt)}</td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr><td colSpan={4} className="dash-td-empty">활동 기록 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function TagStats({ tags }) {
  // 상위 20개만 렌더링
  const visible = useMemo(() => tags.slice(0, 20), [tags])
  const max = Math.max(...visible.map((t) => t.count), 1)
  return (
    <div className="dash-section">
      <h3 className="dash-section-title">태그 분포 TOP 20</h3>
      <div className="dash-tag-list">
        {visible.map(({ tag, count }) => (
          <div key={tag} className="dash-tag-row">
            <span className="dash-tag-name">{tag}</span>
            <div className="dash-bar-wrap">
              <div
                className="dash-bar dash-bar--tag"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="dash-tag-count">{count}</span>
          </div>
        ))}
        {visible.length === 0 && <div className="dash-td-empty">태그 없음</div>}
      </div>
    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────────

export default function DashboardPage() {
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  // StrictMode의 useEffect 2회 실행 방지 guard
  const loadingRef = useRef(false)

  useEffect(() => {
    if (loadingRef.current) {
      console.log('[Dashboard] useEffect 중복 호출 감지 — 건너뜀')
      return
    }
    loadingRef.current = true

    const fetchStats = async () => {
      console.log('[Dashboard] getDashboardStats 호출 시작')
      console.time('[Dashboard] IPC get-dashboard-stats')
      setLoading(true)
      setError(null)
      try {
        const result = await window.api.getDashboardStats()
        console.timeEnd('[Dashboard] IPC get-dashboard-stats')
        console.log('[Dashboard] 수신 완료 —', {
          totalVideos:       result.summary?.totalVideos,
          topActors:         result.topActors?.length,
          recentVideos:      result.recentVideos?.length,
          recentActivities:  result.recentActivities?.length,
          ratingDistribution: result.ratingDistribution?.length,
          tagStats:          result.tagStats?.length,
        })
        setStats(result)
      } catch (e) {
        console.timeEnd('[Dashboard] IPC get-dashboard-stats')
        console.error('[Dashboard] 통계 조회 실패:', e)
        setError(e.message || '통계 로드 실패')
      } finally {
        setLoading(false)
      }
    }

    fetchStats()

    return () => {
      // cleanup: StrictMode unmount 시 guard 해제 (개발 환경 재마운트 대응)
      loadingRef.current = false
    }
  }, [])

  if (loading) {
    return <div className="dash-loading">통계 로딩 중…</div>
  }

  if (error) {
    return <div className="dash-error">통계 로드 실패: {error}</div>
  }

  if (!stats) return null

  return (
    <div className="dash-root">
      <h2 className="dash-title">대시보드</h2>

      {/* 요약 카드 */}
      <SummaryCards summary={stats.summary} />

      {/* 2열 레이아웃 */}
      <div className="dash-grid">
        <RatingDistribution data={stats.ratingDistribution} />
        <TopActors          actors={stats.topActors} />
        <RecentVideos       videos={stats.recentVideos} />
        <RecentActivities   activities={stats.recentActivities} />
        <TagStats           tags={stats.tagStats} />
      </div>
    </div>
  )
}
