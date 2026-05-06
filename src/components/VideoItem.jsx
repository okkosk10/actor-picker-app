/**
 * src/components/VideoItem.jsx
 * 동영상 목록의 단일 항목 컴포넌트
 *
 * Props:
 *   video    {Video}    - DB 레코드
 *   selected {boolean}  - 선택 여부
 *   onClick  {Function} - 클릭 콜백
 *
 * 표시 정보:
 *   - 품번 (code badge)
 *   - 배우명
 *   - 별점 (읽기 전용, StarRating)
 *   - 추천 / 상태 / 삭제됨 배지 (Ant Design Tag)
 *   - 태그 칩 목록 (Ant Design Tag)
 *   - 파일명
 *   - 폴더명 (마지막 경로 세그먼트)
 *   - 메모 미리보기
 */
import { Tag } from 'antd'
import StarRating from './StarRating.jsx'
import { STATUS_LABELS } from '../utils/format.js'

// 상태(status)별 Ant Design Tag color 매핑
const STATUS_COLORS = {
  watched:  'green',
  favorite: 'gold',
  later:    'default',
  missing:  'red',
}

export default function VideoItem({ video, selected, onClick }) {
  // 상태 기반 좌측 테두리 색상 클래스
  const borderClass = video.status && video.status !== 'normal'
    ? ` video-item--${video.status}`
    : ''

  // 태그 파싱 (쉼표 구분)
  const tagList = video.tags
    ? video.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : []

  return (
    <div
      className={`video-item${selected ? ' video-item--selected' : ''}${borderClass}`}
      onClick={() => onClick(video)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(video)}
    >
      {/* ── 1행: 품번 + 배우명 + 별점 ────────────────────────── */}
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
        <StarRating value={video.rating || 0} readOnly size="sm" />
      </div>

      {/* ── 2행: 파일명 ───────────────────────────────────────── */}
      <div className="vi-filename" title={video.file_name}>
        {video.file_name}
      </div>

      {/* ── 3행: 배지 묶음 (Ant Design Tag) ─────────────────── */}
      <div className="vi-badges">
        {/* 추천작 배지 — recommended=1 일 때만 표시 */}
        {Boolean(video.recommended) && (
          <Tag color="warning" style={{ fontWeight: 600 }}>⭐ 추천</Tag>
        )}

        {/* 상태 배지 (normal 은 표시 생략) */}
        {video.status && video.status !== 'normal' && (
          <Tag color={STATUS_COLORS[video.status] || 'default'}>
            {STATUS_LABELS[video.status] || video.status}
          </Tag>
        )}

        {/* 사용자 태그 칩 */}
        {tagList.map((tag) => (
          <Tag key={tag} color="blue">{tag}</Tag>
        ))}
      </div>

      {/* ── 4행: 폴더 + 메모 미리보기 ────────────────────────── */}
      <div className="vi-footer">
        <span className="vi-folder" title={video.folder_path}>
          📁 {video.folder_path.split(/[\\/]/).pop()}
        </span>
        {video.memo && (
          <span className="vi-memo-preview" title={video.memo}>
            {video.memo}
          </span>
        )}
      </div>
    </div>
  )
}
