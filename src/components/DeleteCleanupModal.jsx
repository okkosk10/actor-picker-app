/**
 * src/components/DeleteCleanupModal.jsx
 * 삭제요망 파일 일괄 삭제 확인 모달
 *
 * Props:
 *   onClose       {Function}    - 모달 닫기 콜백
 *   onDeleted     {Function}    - 삭제 완료 후 목록 새로고침 콜백
 *   currentFolder {string|null} - 폴더 필터 (null이면 전체 라이브러리)
 *
 * 흐름:
 *   1. 마운트 시 getDeleteCandidates API 호출 → 대상 목록 표시
 *   2. "삭제 실행" 버튼 클릭 → deleteGradeTargets API 호출
 *   3. 삭제 결과(성공/실패 리포트) 표시
 *   4. 닫기 시 onDeleted() 호출하여 검색 목록 새로고침
 *
 * 보안:
 *   - Renderer에서 fs 직접 접근 없음
 *   - Main Process(ipc.cjs)에서만 실제 파일 삭제
 *   - grade='삭제요망' 이 아닌 파일은 Main에서 처리 안 함
 */
import { useState, useEffect, useRef } from 'react'
import { Tag } from 'antd'
import { formatFileSize } from '../utils/format.js'

// 삭제 모달의 내부 단계
const STEP = {
  LOADING:  'loading',   // 목록 조회 중
  CONFIRM:  'confirm',   // 삭제 전 확인 단계
  DELETING: 'deleting',  // 삭제 실행 중
  RESULT:   'result',    // 삭제 완료 결과 표시
  EMPTY:    'empty',     // 삭제 대상 없음
  ERROR:    'error',     // 조회/삭제 오류
}

export default function DeleteCleanupModal({ onClose, onDeleted, currentFolder }) {
  const overlayRef = useRef(null)

  // ── 단계별 상태 ────────────────────────────────────────────
  const [step,       setStep]       = useState(STEP.LOADING)
  const [candidates, setCandidates] = useState(null)  // { total, totalSize, items }
  const [result,     setResult]     = useState(null)  // { total, deleted, failed, failedItems }
  const [errorMsg,   setErrorMsg]   = useState('')

  // ── 삭제 대상 목록 조회 ────────────────────────────────────
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const data = await window.api.getDeleteCandidates(currentFolder)
        if (!mounted) return
        if (data.total === 0) {
          setStep(STEP.EMPTY)
        } else {
          setCandidates(data)
          setStep(STEP.CONFIRM)
        }
      } catch (e) {
        if (!mounted) return
        setErrorMsg('목록 조회 실패: ' + e.message)
        setStep(STEP.ERROR)
      }
    })()
    return () => { mounted = false }
  }, [])

  // ── 실제 삭제 실행 ─────────────────────────────────────────
  const handleDelete = async () => {
    setStep(STEP.DELETING)
    try {
      const data = await window.api.deleteGradeTargets(currentFolder)
      setResult(data)
      setStep(STEP.RESULT)
    } catch (e) {
      setErrorMsg('삭제 실패: ' + e.message)
      setStep(STEP.ERROR)
    }
  }

  // ── 닫기 (새로고침 포함) ───────────────────────────────────
  const handleClose = () => {
    // 삭제가 일어났으면 검색 목록 새로고침
    if (step === STEP.RESULT && result?.deleted > 0) {
      onDeleted()
    }
    onClose()
  }

  // 오버레이 클릭 닫기 (loading/deleting 중에는 막기)
  const handleOverlayClick = (e) => {
    if (e.target !== overlayRef.current) return
    if (step === STEP.LOADING || step === STEP.DELETING) return
    handleClose()
  }

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="삭제요망 정리"
    >
      <div className="modal">
        {/* ── 헤더 ──────────────────────────────────────────── */}
        <div className="modal-header">
          <h2 className="modal-title">🗑 삭제요망 정리</h2>
          {step !== STEP.LOADING && step !== STEP.DELETING && (
            <button
              className="modal-close"
              type="button"
              onClick={handleClose}
              aria-label="닫기"
            >
              ✕
            </button>
          )}
        </div>

        {/* ─────────────────────────────────────────────────── */}
        {/* STEP: 조회 중 */}
        {step === STEP.LOADING && (
          <div className="modal-empty">목록을 조회하는 중...</div>
        )}

        {/* STEP: 대상 없음 */}
        {step === STEP.EMPTY && (
          <div className="modal-empty">
            <p>등급이 <Tag color="red">삭제요망</Tag>인 파일이 없습니다.</p>
            <div className="modal-actions">
              <button className="btn-secondary" type="button" onClick={handleClose}>닫기</button>
            </div>
          </div>
        )}

        {/* STEP: 삭제 전 확인 */}
        {step === STEP.CONFIRM && candidates && (
          <>
            {/* 요약 정보 */}
            <div className="modal-stats">
              <span className="stat-item">
                삭제 대상 <strong style={{ color: '#ef4444' }}>{candidates.total}</strong>개
              </span>
              <span className="stat-sep">·</span>
              <span className="stat-item">
                총 용량 <strong>{formatFileSize(candidates.totalSize)}</strong>
              </span>
            </div>

            {/* 경고 문구 */}
            <div className="delete-warn">
              ⚠ 아래 파일들이 <strong>영구 삭제</strong>됩니다. 복구할 수 없습니다.
            </div>

            {/* 파일 목록 (최대 50개 표시) */}
            <div className="modal-list-wrap">
              <table className="picked-table">
                <thead>
                  <tr>
                    <th>파일명</th>
                    <th>크기</th>
                    <th>배우</th>
                    <th>품번</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.items.slice(0, 50).map((item) => (
                    <tr key={item.id}>
                      <td className="td-filename" title={item.file_path}>{item.file_name}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatFileSize(item.size)}</td>
                      <td>{item.actor_name || '-'}</td>
                      <td><code className="code-cell">{item.code || '-'}</code></td>
                    </tr>
                  ))}
                  {candidates.items.length > 50 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        … 외 {candidates.items.length - 50}개 더
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 액션 버튼 */}
            <div className="modal-actions">
              <button className="btn-secondary" type="button" onClick={handleClose}>
                취소
              </button>
              <button className="btn-danger" type="button" onClick={handleDelete}>
                🗑 {candidates.total}개 영구 삭제
              </button>
            </div>
          </>
        )}

        {/* STEP: 삭제 중 */}
        {step === STEP.DELETING && (
          <div className="modal-empty">파일을 삭제하는 중... 잠시 기다려 주세요.</div>
        )}

        {/* STEP: 삭제 완료 결과 */}
        {step === STEP.RESULT && result && (
          <>
            <div className="modal-stats">
              <span className="stat-item">
                처리 <strong>{result.total}</strong>개
              </span>
              <span className="stat-sep">·</span>
              <span className="stat-item" style={{ color: '#22c55e' }}>
                성공 <strong>{result.deleted}</strong>개
              </span>
              {result.failed > 0 && (
                <>
                  <span className="stat-sep">·</span>
                  <span className="stat-item" style={{ color: '#ef4444' }}>
                    실패 <strong>{result.failed}</strong>개
                  </span>
                </>
              )}
            </div>

            {/* 실패 항목 상세 */}
            {result.failedItems && result.failedItems.length > 0 && (
              <div className="modal-list-wrap">
                <p style={{ marginBottom: 8, fontWeight: 600, color: '#ef4444' }}>
                  삭제 실패 목록:
                </p>
                <table className="picked-table">
                  <thead>
                    <tr>
                      <th>파일 경로</th>
                      <th>실패 사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.failedItems.map((fi, idx) => (
                      <tr key={idx}>
                        <td className="td-filename" title={fi.file_path}>
                          {fi.file_path}
                        </td>
                        <td style={{ color: '#ef4444' }}>{fi.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-primary" type="button" onClick={handleClose}>
                확인
              </button>
            </div>
          </>
        )}

        {/* STEP: 오류 */}
        {step === STEP.ERROR && (
          <div className="modal-empty">
            <p style={{ color: '#ef4444' }}>{errorMsg}</p>
            <div className="modal-actions">
              <button className="btn-secondary" type="button" onClick={handleClose}>닫기</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
