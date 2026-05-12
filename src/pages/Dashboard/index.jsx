/**
 * src/pages/Dashboard/index.jsx
 * 대시보드 페이지 — 통계 탭 + 스마트 추천 탭
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import DashboardRecommendations from './DashboardRecommendations.jsx'
import AiThemeFolderCenter from '../../components/AiThemeFolderCenter.jsx'
import './Dashboard.css'

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

function SummaryCards({ summary }) {
  const cards = [
    { label: '전체 영상',     value: (summary.totalVideos    ?? 0).toLocaleString() + '개' },
    { label: '등록 배우',     value: (summary.totalActors    ?? 0).toLocaleString() + '명' },
    { label: '전체 용량',     value: formatBytes(summary.totalSize) },
    { label: '평균 별점',     value: summary.averageRating ? `${summary.averageRating}점` : '—' },
    { label: 'NEW 대기',      value: (summary.newCount       ?? 0).toLocaleString() + '개' },
    { label: '총 재생',       value: (summary.openTotal      ?? 0).toLocaleString() + '회' },
    { label: '클립보드 복사', value: (summary.copyClipTotal  ?? 0).toLocaleString() + '회' },
    { label: '장치 복사',     value: (summary.copyDeviceTotal ?? 0).toLocaleString() + '회' },
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

function RatingDistribution({ data, title = '영상 별점 분포' }) {
  const max = Math.max(...data.map((r) => r.count), 1)
  return (
    <div className="dash-section">
      <h3 className="dash-section-title">{title}</h3>
      <div className="dash-rating-bars">
        {data.map(({ rating, count }) => (
          <div key={rating} className="dash-rating-row">
            <span className="dash-rating-label">{rating > 0 ? '★'.repeat(rating) : '없음'}</span>
            <div className="dash-bar-wrap">
              <div className="dash-bar" style={{ width: `${(count / max) * 100}%` }} />
            </div>
            <span className="dash-rating-count">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TopActors({ actors, title = '재생 TOP 10', countField = 'playCount', countLabel = '재생' }) {
  const visible = useMemo(() => actors.slice(0, 10), [actors])
  return (
    <div className="dash-section">
      <h3 className="dash-section-title">{title}</h3>
      <table className="dash-table">
        <thead>
          <tr><th>#</th><th>배우</th><th>별점</th><th>작품 수</th><th>{countLabel}</th></tr>
        </thead>
        <tbody>
          {visible.map((a, i) => (
            <tr key={a.actorId}>
              <td className="dash-td-rank">{i + 1}</td>
              <td>{a.actorName}</td>
              <td>{a.actorRating > 0 ? '★'.repeat(a.actorRating) : '—'}</td>
              <td>{a.videoCount}</td>
              <td>{a[countField] ?? 0}</td>
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
          <tr><th>파일명</th><th>배우</th><th>별점</th><th>등급</th><th>마지막 재생</th><th>수정일</th></tr>
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
  const visible = useMemo(() => activities.slice(0, 15), [activities])
  return (
    <div className="dash-section">
      <h3 className="dash-section-title">최근 활동</h3>
      <table className="dash-table">
        <thead>
          <tr><th>액션</th><th>파일명</th><th>배우</th><th>시각</th></tr>
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

function TagStats({ tags, title = '영상 태그 TOP 20' }) {
  const visible = useMemo(() => tags.slice(0, 20), [tags])
  const max = Math.max(...visible.map((t) => t.count), 1)
  return (
    <div className="dash-section">
      <h3 className="dash-section-title">{title}</h3>
      <div className="dash-tag-list">
        {visible.map(({ tag, count }) => (
          <div key={tag} className="dash-tag-row">
            <span className="dash-tag-name">{tag}</span>
            <div className="dash-bar-wrap">
              <div className="dash-bar dash-bar--tag" style={{ width: `${(count / max) * 100}%` }} />
            </div>
            <span className="dash-tag-count">{count}</span>
          </div>
        ))}
        {visible.length === 0 && <div className="dash-td-empty">태그 없음</div>}
      </div>
    </div>
  )
}

export default function DashboardPage({ onViewDetail, onCopyFiles }) {
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [dashTab, setDashTab] = useState('stats')   // 'stats' | 'recs' | 'ai-theme'
  const loadingRef = useRef(false)

  // AI 연결 테스트 상태
  const [aiTesting,   setAiTesting]   = useState(false)
  const [aiResult,    setAiResult]    = useState(null)   // { success, model?, message?, error? }

  const handleAiTest = async () => {
    setAiTesting(true)
    setAiResult(null)
    try {
      const result = await window.api.testAiConnection()
      setAiResult(result)
    } catch (e) {
      setAiResult({ success: false, error: e.message })
    } finally {
      setAiTesting(false)
    }
  }

  const fetchStats = async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.getDashboardStats()
      setStats(result)
    } catch (e) {
      setError(e.message || '통계 로드 실패')
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }

  useEffect(() => { fetchStats() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !stats) return <div className="dash-loading">통계 로딩 중…</div>
  if (error && !stats) return (
    <div className="dash-error">
      통계 로드 실패: {error}
      <button className="btn-secondary" onClick={fetchStats} style={{ marginLeft: 12 }}>재시도</button>
    </div>
  )

  return (
    <div className="dash-root">
      <div className="dash-header">
        <h2 className="dash-title">대시보드</h2>
        <div className="dash-tab-row">
          <button
            type="button"
            className={`dash-tab-btn ${dashTab === 'stats' ? 'dash-tab-btn--active' : ''}`}
            onClick={() => setDashTab('stats')}
          >
            📈 통계
          </button>
          <button
            type="button"
            className={`dash-tab-btn ${dashTab === 'recs' ? 'dash-tab-btn--active' : ''}`}
            onClick={() => setDashTab('recs')}
          >
            🎯 스마트 추천
          </button>
          <button
            type="button"
            className={`dash-tab-btn ${dashTab === 'ai-theme' ? 'dash-tab-btn--active' : ''}`}
            onClick={() => setDashTab('ai-theme')}
          >
            🎬 AI 특집 폴더
          </button>
        </div>
        {dashTab === 'stats' && (
          <button className="btn-secondary" type="button" onClick={fetchStats}>
            🔄 통계 새로고침
          </button>
        )}
        <button
          className="btn-secondary"
          type="button"
          onClick={handleAiTest}
          disabled={aiTesting}
          style={{ marginLeft: 8 }}
        >
          {aiTesting ? '🤖 연결 테스트 중…' : '🤖 AI 연결 테스트'}
        </button>
        {aiResult && (
          <span
            style={{
              marginLeft: 10,
              fontWeight: 600,
              color: aiResult.success ? '#52c41a' : '#ff4d4f',
            }}
          >
            {aiResult.success
              ? `✅ 연결 성공 (${aiResult.model}) — "${aiResult.message}"`
              : `❌ 연결 실패: ${aiResult.error}`}
          </span>
        )}
      </div>

      {/* 스마트 추천 탭 */}
      {dashTab === 'recs' && (
        <DashboardRecommendations
          onCopyFiles={onCopyFiles}
          onViewDetail={onViewDetail}
        />
      )}

      {/* AI 특집 폴더 탭 */}
      {dashTab === 'ai-theme' && <AiThemeFolderCenter />}

      {/* 통계 탭 */}
      {dashTab === 'stats' && (!stats ? null : (
        <>
          <SummaryCards summary={stats.summary} />
          <div className="dash-grid">
            <RatingDistribution data={stats.ratingDistribution} title="영상 별점 분포" />
            <RatingDistribution data={stats.actorRatingDistribution ?? []} title="배우 별점 분포" />
            <TopActors actors={stats.topActors} title="배우 재생 TOP 10" countField="playCount" countLabel="재생" />
            <TopActors actors={stats.topCopyActors ?? []} title="배우 복사 TOP 10" countField="copyCount" countLabel="복사" />
            <TagStats tags={stats.tagStats} title="영상 태그 TOP 20" />
            <TagStats tags={stats.actorTagStats ?? []} title="배우 태그 TOP 20" />
            <RecentVideos videos={stats.recentVideos} />
            <RecentActivities activities={stats.recentActivities} />
          </div>
        </>
      ))}
    </div>
  )
}
