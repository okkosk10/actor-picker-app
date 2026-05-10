/**
 * src/components/VideoList.jsx
 * 동영상 목록 컨테이너 — @tanstack/react-virtual 기반 가상 스크롤
 *
 * Props:
 *   videos        {Video[]}     - 표시할 영상 목록
 *   selectedId    {number}      - 현재 선택된 영상 ID
 *   onSelect      {Function}    - 항목 선택 콜백 (video 객체)
 *   loading       {boolean}     - 로딩 중 여부
 *   checkedIds    {Set<number>} - 파일 복사용 체크박스 선택 ID 집합
 *   onToggleCheck {Function}    - 체크박스 토글 콜백 (e, id)
 *   onToggleAll   {Function}    - 전체 선택/해제 콜백 (checkAll: boolean)
 */
import { useRef, useEffect, useMemo } from 'react'
import { useVirtualizer }             from '@tanstack/react-virtual'
import VideoItem                      from './VideoItem.jsx'

export default function VideoList({ videos, selectedId, onSelect, loading, checkedIds, onToggleCheck, onToggleAll }) {
  const parentRef = useRef(null)
  const masterRef = useRef(null)

  const checkedCount = useMemo(() => (checkedIds ? checkedIds.size : 0), [checkedIds])
  const allChecked   = useMemo(() => videos.length > 0 && checkedCount === videos.length, [videos.length, checkedCount])
  const someChecked  = useMemo(() => checkedCount > 0 && !allChecked, [checkedCount, allChecked])

  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someChecked
  }, [someChecked])

  const rowVirtualizer = useVirtualizer({
    count:           videos.length,
    getScrollElement: () => parentRef.current,
    estimateSize:    () => 122,  // VideoItem 평균 높이 (px)
    overscan:        8,
  })

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
            {checkedCount > 0 ? `${checkedCount}개 선택됨` : '전체 선택'}
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

      {/* ── 가상 스크롤 컨테이너 ──────────────────────────────── */}
      <div ref={parentRef} className="video-list-scroll">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const v = videos[vi.index]
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position:  'absolute',
                  top:       0,
                  left:      0,
                  width:     '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <VideoItem
                  video={v}
                  selected={selectedId === v.id}
                  onClick={onSelect}
                  checked={checkedIds ? checkedIds.has(v.id) : false}
                  onToggle={onToggleCheck}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
