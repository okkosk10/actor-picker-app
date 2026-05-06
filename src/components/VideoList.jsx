/**
 * src/components/VideoList.jsx
 * 동영상 목록 컨테이너 컴포넌트
 *
 * Props:
 *   videos        {Video[]}     - 표시할 영상 목록
 *   selectedId    {number}      - 현재 선택된 영상 ID (상세 패널)
 *   onSelect      {Function}    - 항목 선택 콜백 (video 객체 전달)
 *   loading       {boolean}     - 로딩 중 여부
 *   checkedIds    {Set<number>} - 파일 복사용 체크박스 선택 ID 집합
 *   onToggleCheck {Function}    - 체크박스 토글 콜백 (e, id) => void
 *   onToggleAll   {Function}    - 전체 선택/해제 콜백 (checkAll: boolean) => void
 */
import { useRef, useEffect } from 'react'
import VideoItem from './VideoItem.jsx'

export default function VideoList({ videos, selectedId, onSelect, loading, checkedIds, onToggleCheck, onToggleAll }) {
  const masterRef = useRef(null)

  const checkedCount = checkedIds ? checkedIds.size : 0
  const allChecked   = videos.length > 0 && checkedCount === videos.length
  const someChecked  = checkedCount > 0 && !allChecked

  // indeterminate 는 ref 로 직접 설정해야 함
  useEffect(() => {
    if (masterRef.current) {
      masterRef.current.indeterminate = someChecked
    }
  }, [someChecked])

  if (loading) {
    return (
      <div className="video-list">
        <div className="empty-state">
          <div className="empty-icon">⏳</div>
          <p>불러오는 중...</p>
        </div>
      </div>
    )
  }

  if (videos.length === 0) {
    return (
      <div className="video-list">
        <div className="empty-state">
          <div className="empty-icon">🎬</div>
          <p>동영상이 없습니다.</p>
          <p className="empty-hint">폴더를 선택하고 스캔하세요.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="video-list">
      {/* ── 전체 선택 헤더 바 ─────────────────────────────────── */}
      <div className="video-list-header">
        <label className="video-list-check-all">
          <input
            ref={masterRef}
            type="checkbox"
            className="vi-checkbox"
            checked={allChecked}
            onChange={(e) => onToggleAll && onToggleAll(e.target.checked)}
            aria-label="전체 선택"
          />
          <span className="video-list-check-label">
            {checkedCount > 0
              ? `${checkedCount}개 선택됨`
              : '전체 선택'}
          </span>
        </label>
        {checkedCount > 0 && (
          <button
            className="video-list-deselect"
            type="button"
            onClick={() => onToggleAll && onToggleAll(false)}
          >
            선택 해제
          </button>
        )}
      </div>

      {videos.map((v) => (
        <VideoItem
          key={v.id}
          video={v}
          selected={selectedId === v.id}
          onClick={onSelect}
          checked={checkedIds ? checkedIds.has(v.id) : false}
          onToggle={onToggleCheck}
        />
      ))}
    </div>
  )
}
