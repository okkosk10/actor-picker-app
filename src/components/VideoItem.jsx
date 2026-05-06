/**
 * src/components/VideoItem.jsx
 * 동영상 목록의 단일 항목 컴포넌트
 *
 * Props:
 *   video    {Video}    - DB 레코드
 *   selected {boolean}  - 선택 여부
 *   onClick  {Function} - 클릭 콜백
 *
 * 표시 레이아웃:
 *   1행: 품번(code badge) + 배우명
 *   2행: ⭐ 추천 Tag | 등급 Tag | 사용자 태그 칩
 *   3행: 별점 (StarRating, 읽기 전용)
 *   4행: 파일명
 *   5행: 폴더명 | 메모 미리보기
 */
import { Tag } from 'antd'
import StarRating from './StarRating.jsx'
import { GRADE_COLORS } from '../utils/format.js'

// missing 상태 Tag color
const STATUS_MISSING_COLOR = 'red'

export default function VideoItem({ video, selected, onClick }) {
  // missing 상태일 때 좌측 테두리 강조
  const borderClass = video.status === 'missing' ? ' video-item--missing' : ''

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
      {/* ── 1행: 품번 + 배우명 ────────────────────────────────── */}
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
      </div>

      {/* ── 2행: 배지 묶음 ────────────────────────────────────── */}
      <div className="vi-badges">
        {/* NEW 배지 — is_new=1 일 때만 표시 (작업 대기 상태) */}
        {Boolean(video.is_new) && (
          <Tag color="green" style={{ fontWeight: 700, letterSpacing: 1 }}>NEW</Tag>
        )}

        {/* 추천작 배지 — recommended=1 일 때만 */}
        {Boolean(video.recommended) && (
          <Tag color="warning" style={{ fontWeight: 600 }}>⭐ 추천</Tag>
        )}

        {/* 등급 배지 — 보관(기본값)은 생략해서 화면을 깔끔하게 유지 */}
        {video.grade && video.grade !== '보관' && (
          <Tag color={GRADE_COLORS[video.grade] || 'default'}>{video.grade}</Tag>
        )}

        {/* missing 배지 */}
        {video.status === 'missing' && (
          <Tag color={STATUS_MISSING_COLOR}>삭제됨</Tag>
        )}

        {/* 사용자 태그 칩 */}
        {tagList.map((tag) => (
          <Tag key={tag} color="blue">{tag}</Tag>
        ))}
      </div>

      {/* ── 3행: 별점 ─────────────────────────────────────────── */}
      <StarRating value={video.rating || 0} readOnly size="sm" />

      {/* ── 4행: 파일명 ───────────────────────────────────────── */}
      <div className="vi-filename" title={video.file_name}>
        {video.file_name}
      </div>

      {/* ── 5행: 폴더 + 메모 미리보기 ────────────────────────── */}
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
