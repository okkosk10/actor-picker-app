/**
 * src/components/OrResultModal.jsx
 * 검색 결과 OR문 생성 결과 모달
 *
 * Props:
 *   videos  {Video[]}  - 현재 화면의 검색 결과 목록 (App의 videos state)
 *   onClose {Function} - 모달 닫기 콜백
 *
 * 동작:
 *   - 유효 videos(code 있음, missing/deleted/삭제요망 제외) 에서 OR문 생성
 *   - 선택 개수 / 총 용량 통계 표시
 *   - textarea (readOnly) 에 OR문 표시
 *   - "복사" 버튼으로 클립보드 복사 + message.success 표시
 *   - 오버레이 클릭 또는 ✕ 버튼으로 닫기
 */
import { useRef, useMemo } from 'react'
import { message } from 'antd'
import { formatFileSize } from '../utils/format.js'

export default function OrResultModal({ videos, onClose }) {
  const overlayRef = useRef(null)

  // ── 유효 항목 필터링 (code 있음, missing/deleted/삭제요망 제외) ─
  const validVideos = useMemo(() => {
    return videos.filter(
      (v) =>
        v.code &&
        v.status !== 'missing' &&
        v.status !== 'deleted' &&
        v.grade  !== '삭제요망',
    )
  }, [videos])

  // ── 중복 code 제거 후 OR문 생성 ───────────────────────────
  const codes = useMemo(
    () => Array.from(new Set(validVideos.map((v) => v.code))),
    [validVideos],
  )
  const orText = codes.join(' OR ')

  // ── 총 용량 계산 (유효 항목 기준) ─────────────────────────
  const totalSize = useMemo(
    () => validVideos.reduce((sum, v) => sum + (v.size || 0), 0),
    [validVideos],
  )

  // ── OR문 클립보드 복사 ─────────────────────────────────────
  const handleCopy = async () => {
    if (!orText) return
    try {
      await navigator.clipboard.writeText(orText)
      message.success(`${codes.length}개 품번 OR문을 복사했습니다.`)
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
      aria-label="검색 결과 OR문"
    >
      <div className="modal">
        {/* ── 헤더 ──────────────────────────────────────────── */}
        <div className="modal-header">
          <h2 className="modal-title">📋 검색 결과 OR문</h2>
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
            선택 개수 <strong>{codes.length}</strong>개
          </span>
          <span className="stat-item">
            총 용량 <strong>{formatFileSize(totalSize)}</strong>
          </span>
        </div>

        {/* ── OR문 표시 + 복사 ───────────────────────────────── */}
        {orText ? (
          <div className="modal-searchbox">
            <div className="modal-searchbox-header">
              <span className="modal-searchbox-label">OR 검색식</span>
              <button
                className="btn-copy"
                type="button"
                onClick={handleCopy}
              >
                OR문 복사
              </button>
            </div>
            <textarea
              className="modal-textarea"
              readOnly
              value={orText}
              rows={4}
            />
          </div>
        ) : (
          <p className="modal-empty">복사할 품번이 없습니다. (조건에 맞는 항목 없음)</p>
        )}
      </div>
    </div>
  )
}
