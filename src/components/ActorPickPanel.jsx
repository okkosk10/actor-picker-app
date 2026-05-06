/**
 * src/components/ActorPickPanel.jsx
 * 배우별 1개 랜덤 추출 결과 모달
 *
 * Props:
 *   result  {object}   - pickOnePerActor API 응답 { count, orText, items }
 *   onClose {Function} - 모달 닫기 콜백
 *
 * 기능:
 *   - 추출된 배우 수 / 영상 목록 표시
 *   - OR 검색식 텍스트 표시 ("SSIS-001 OR IPZZ-123 OR ...")
 *   - "OR문 복사" 버튼 클릭 시 클립보드 복사 + message.success 표시
 *   - 오버레이 클릭 또는 ✕ 버튼으로 닫기
 *   - 등급 Tag, 추천 배지, 별점 표시
 */
import { useRef } from 'react'
import { Tag, message } from 'antd'
import { GRADE_COLORS } from '../utils/format.js'

export default function ActorPickPanel({ result, onClose }) {
  const overlayRef = useRef(null)

  // ── OR문 클립보드 복사 ─────────────────────────────────────
  const handleCopyOr = async () => {
    if (!result.orText) return
    try {
      await navigator.clipboard.writeText(result.orText)
      message.success('OR 검색식을 클립보드에 복사했습니다.')
    } catch {
      message.error('복사에 실패했습니다.')
    }
  }

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="배우별 1개 추출 결과"
    >
      <div className="modal">
        {/* ── 헤더 ──────────────────────────────────────────── */}
        <div className="modal-header">
          <h2 className="modal-title">🎯 배우별 1개 추출</h2>
          <button
            className="modal-close"
            type="button"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* ── 통계 ──────────────────────────────────────────── */}
        <div className="modal-stats">
          <span className="stat-item">
            추출 배우 <strong>{result.count}</strong>명
          </span>
        </div>

        {/* ── OR 검색식 ─────────────────────────────────────── */}
        {result.orText ? (
          <div className="modal-searchbox">
            <div className="modal-searchbox-header">
              <span className="modal-searchbox-label">OR 검색식</span>
              <button className="btn-copy" type="button" onClick={handleCopyOr}>
                OR문 복사
              </button>
            </div>
            <textarea
              className="modal-textarea"
              readOnly
              value={result.orText}
              rows={3}
            />
          </div>
        ) : (
          <p className="modal-empty">추출 결과가 없습니다. (조건에 맞는 배우가 없음)</p>
        )}

        {/* ── 추출 결과 목록 ────────────────────────────────── */}
        {result.items && result.items.length > 0 && (
          <div className="modal-list-wrap">
            <table className="picked-table">
              <thead>
                <tr>
                  <th>배우</th>
                  <th>품번</th>
                  <th>등급</th>
                  <th>별점</th>
                  <th>파일명</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr
                    key={item.id}
                    className={item.recommended ? 'picked-row--recommended' : ''}
                  >
                    <td>{item.actor_name || '-'}</td>
                    <td>
                      <code className="code-cell">{item.code || '-'}</code>
                      {Boolean(item.recommended) && (
                        <span
                          className="tag-badge tag-badge--recommended"
                          style={{ marginLeft: 4 }}
                        >
                          ⭐
                        </span>
                      )}
                    </td>
                    <td>
                      {/* 보관(기본값)은 생략하여 화면 간소화 */}
                      {item.grade && item.grade !== '보관' && (
                        <Tag color={GRADE_COLORS[item.grade] || 'default'} style={{ margin: 0 }}>
                          {item.grade}
                        </Tag>
                      )}
                    </td>
                    <td>{'★'.repeat(item.rating || 0)}</td>
                    <td className="td-filename">{item.file_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
