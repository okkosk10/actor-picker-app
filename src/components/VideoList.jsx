/**
 * src/components/VideoList.jsx
 * 동영상 목록 컨테이너 컴포넌트
 *
 * Props:
 *   videos     {Video[]}  - 표시할 영상 목록
 *   selectedId {number}   - 현재 선택된 영상 ID
 *   onSelect   {Function} - 항목 선택 콜백 (video 객체 전달)
 *   loading    {boolean}  - 로딩 중 여부
 */
import VideoItem from './VideoItem.jsx'

export default function VideoList({ videos, selectedId, onSelect, loading }) {
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
      {videos.map((v) => (
        <VideoItem
          key={v.id}
          video={v}
          selected={selectedId === v.id}
          onClick={onSelect}
        />
      ))}
    </div>
  )
}
