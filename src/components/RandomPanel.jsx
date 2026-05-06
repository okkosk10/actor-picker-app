/**
 * src/components/RandomPanel.jsx
 * 랜덤 추천 결과 모달 컴포넌트
 *
 * Props:
 *   result  {object}   - randomPick API 응답
 *   onClose {Function} - 모달 닫기 콜백
 */
import { useRef } from 'react'

export default function RandomPanel({ result, onClose }) {
  const overlayRef = useRef(null)

  const handleCopy = () => {
    if (result.searchText) {
      navigator.clipboard.writeText(result.searchText)
    }
  }

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="랜덤 추천 결과"
    >
      <div className="modal">
        {/* 모달 헤더 */}
        <div className="modal-header">
          <h2 className="modal-title">🎲 랜덤 추천</h2>
          <button className="modal-close" type="button" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        {/* 통계 */}
        <div className="modal-stats">
          <span className="stat-item">
            영상 <strong>{result.totalFiles}</strong>개
          </span>
          <span className="stat-sep">·</span>
          <span className="stat-item">
            배우 <strong>{result.actorCount}</strong>명
          </span>
          <span className="stat-sep">·</span>
          <span className="stat-item">
            선택 <strong>{result.pickedCount}</strong>개
          </span>
        </div>

        {/* OR 검색식 */}
        {result.searchText && (
          <div className="modal-searchbox">
            <div className="modal-searchbox-header">
              <span className="modal-searchbox-label">OR 검색식</span>
              <button className="btn-copy" type="button" onClick={handleCopy}>
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
                  <th>별점</th>
                  <th>파일명</th>
                </tr>
              </thead>
              <tbody>
                {result.pickedList.map((item) => (
                  <tr key={item.id} className={item.recommended ? 'picked-row--recommended' : ''}>
                    <td>{item.actor_name || '-'}</td>
                    <td>
                      <code className="code-cell">{item.code || '-'}</code>
                      {Boolean(item.recommended) && (
                        <span className="tag-badge tag-badge--recommended" style={{ marginLeft: 4 }}>추천</span>
                      )}
                    </td>
                    <td>{'★'.repeat(item.rating || 0)}</td>
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
