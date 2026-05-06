/**
 * src/components/FileCopyModal.jsx
 * 파일 복사 모달
 *   - 클립보드 복사 (CF_HDROP + Preferred DropEffect)
 *   - MTP 큐 전송 (1개씩 순차, needsCheck 일시정지 + 조치 UI)
 *   - MTP 안정 모드 (Windows 복사 창 위임)
 */
import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { message }                                           from 'antd'
import { formatFileSize }                                    from '../utils/format.js'

const IDLE_STATE = {
  status:          'idle',
  currentIndex:    0,
  total:           0,
  currentFileName: '',
  fileSize:        0,
  timeoutSec:      0,
  doneCount:       0,
  failedCount:     0,
  failedFiles:     [],
  message:         '',
}

const STATUS_LABEL = {
  idle:        '',
  selecting:   '📂 폴더 선택 중…',
  copying:     '📤 전송 중…',
  completed:   '✅ 파일 완료',
  needsCheck:  '⚠️ 확인 필요 — 일시정지됨',
  skipped:     '⏭ 건너뜀',
  cancelled:   '취소됨',
  done:        '🎉 전송 완료',
}

export default function FileCopyModal({ videos, selectedIds, onClose }) {
  const overlayRef = useRef(null)
  const [copying,      setCopying]      = useState(false)
  const [copyResult,   setCopyResult]   = useState(null)
  const [transfer,     setTransfer]     = useState(IDLE_STATE)
  const [retryFiles,   setRetryFiles]   = useState(null)
  const [bulkStatus,   setBulkStatus]   = useState(null)        // null|'running'|'done'|'cancelled'
  const [transferMode, setTransferMode] = useState('stable')    // 'stable'|'queue'

  const isQueueActive  = ['selecting', 'copying', 'needsCheck'].includes(transfer.status)
  const isBulkActive   = bulkStatus === 'running'
  const isTransferring = isQueueActive || isBulkActive
  const isNeedsCheck   = transfer.status === 'needsCheck'

  // ── 복사 대상 영상 결정 ────────────────────────────────────────
  const targetVideos = useMemo(() => {
    const base =
      selectedIds && selectedIds.size > 0
        ? videos.filter((v) => selectedIds.has(v.id))
        : videos
    return base.filter(
      (v) => v.file_path && v.status !== 'missing' && v.status !== 'deleted',
    )
  }, [videos, selectedIds])

  const totalSize       = useMemo(() => targetVideos.reduce((s, v) => s + (v.size || 0), 0), [targetVideos])
  const isSelectionMode = selectedIds && selectedIds.size > 0

  // ── progress 이벤트 구독 ───────────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI ?? window.api
    if (!api?.onDeviceCopyProgress) return
    const unsubscribe = api.onDeviceCopyProgress((payload) => {
      setTransfer((prev) => ({
        ...prev,
        ...payload,
        failedFiles: payload.failedFiles ?? prev.failedFiles,
      }))
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
      else (window.electronAPI ?? window.api)?.removeDeviceCopyProgress?.()
    }
  }, [])

  // ── 클립보드 복사 ──────────────────────────────────────────────
  const handleClipboard = async () => {
    if (targetVideos.length === 0 || copying) return
    setCopying(true)
    setCopyResult(null)
    const filePaths = targetVideos.map((v) => v.file_path)
    try {
      const result = await (window.electronAPI ?? window.api).copyFilesToClipboard(filePaths)
      setCopyResult(result)
      if (result.success) {
        message.success(`총 ${result.count}개 / ${formatFileSize(result.totalSize)} 클립보드에 복사됨`)
      } else {
        message.error(result.error || '클립보드 복사 실패')
      }
    } catch (err) {
      setCopyResult({ success: false, error: err.message, count: 0, totalSize: 0, failedPaths: [] })
      message.error('클립보드 복사 오류: ' + err.message)
    } finally {
      setCopying(false)
    }
  }

  // ── MTP 안정 모드 (일괄 전송) ─────────────────────────────────
  const handleBulkTransfer = async () => {
    if (isTransferring) return
    setBulkStatus('running')
    const api   = window.electronAPI ?? window.api
    const paths = targetVideos.map((v) => v.file_path)
    try {
      const result = await api.copyFilesToDeviceBulk(paths)
      if (result.action === 'cancelled') {
        setBulkStatus('cancelled')
      } else if (result.success) {
        setBulkStatus('done')
      } else {
        setBulkStatus(null)
        message.error(result.error || '전송 시작 실패')
      }
    } catch (err) {
      setBulkStatus(null)
      message.error('안정 모드 오류: ' + err.message)
    }
  }

  // ── MTP 실험 모드 - 큐 전송 ──────────────────────────────────
  const handleQueueTransfer = useCallback(async (paths) => {
    if (!paths?.length || isTransferring) return
    setTransfer(IDLE_STATE)
    setRetryFiles(null)
    const api = window.electronAPI ?? window.api
    try {
      const result = await api.copyFilesToDevice(paths)
      if (result.action !== 'cancelled' && result.failedFiles?.length > 0)
        setRetryFiles(result.failedFiles)
    } catch (err) {
      message.error('전송 오류: ' + err.message)
    }
  }, [isTransferring])

  const handleStartQueue = () =>
    handleQueueTransfer(targetVideos.map((v) => v.file_path))

  const handleRetryQueue = () => {
    if (!retryFiles?.length || isTransferring) return
    const paths = retryFiles
      .map((name) => targetVideos.find(
        (v) => v.file_path?.endsWith(name) ||
               v.file_path?.endsWith('\\' + name) ||
               v.file_path?.endsWith('/' + name),
      ))
      .filter(Boolean)
      .map((v) => v.file_path)
    handleQueueTransfer(paths)
  }

  const sendAction = (action) =>
    (window.electronAPI ?? window.api)?.sendDeviceCopyAction?.(action)

  // ── 전송 중 닫기 경고 ──────────────────────────────────────────
  const handleClose = () => {
    if (isQueueActive) {
      message.warning('전송 중에는 창을 닫을 수 없습니다. "전체 중단"을 누르거나 전송 완료를 기다리세요.')
      return
    }
    if (isBulkActive) {
      message.warning('Windows 복사 창이 진행 중입니다. 완료 후 닫아 주세요.')
      return
    }
    onClose()
  }

  // ── 진행률 계산 ───────────────────────────────────────────────
  const progressPercent = transfer.total > 0
    ? Math.round(((transfer.doneCount + transfer.failedCount) / transfer.total) * 100)
    : 0

  const isDone        = transfer.status === 'done'
  const timeoutLabel  = transfer.timeoutSec ? `${Math.round(transfer.timeoutSec / 60)}분` : ''
  const fileSizeLabel = transfer.fileSize   ? formatFileSize(transfer.fileSize) : ''

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) handleClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="파일 복사"
    >
      <div className="modal modal--file-copy">

        {/* ── 헤더 ─────────────────────────────────────────── */}
        <div className="modal-header">
          <h2 className="modal-title">📂 파일 복사</h2>
          <button
            className="modal-close"
            type="button"
            onClick={handleClose}
            disabled={isTransferring}
            aria-label="닫기"
          >✕</button>
        </div>

        {/* ── 통계 바 ──────────────────────────────────────── */}
        <div className="modal-stats">
          <span className="stat-item">{isSelectionMode ? '✅ 선택 항목' : '검색 결과 전체'}</span>
          <span className="stat-sep">·</span>
          <span className="stat-item">대기 <strong>{targetVideos.length}</strong>개</span>
          <span className="stat-sep">·</span>
          <span className="stat-item"><strong>{formatFileSize(totalSize)}</strong></span>
        </div>

        {targetVideos.length === 0 ? (
          <p className="modal-empty">복사할 파일이 없습니다. (missing / deleted 항목 제외)</p>
        ) : (
          <>
            {/* ── ① 클립보드 복사 ─────────────────────────── */}
            <div className="file-copy-section">
              <p className="file-copy-hint">
                클립보드에 등록 후 탐색기에서 <kbd>Ctrl+V</kbd>로 붙여넣기합니다.
              </p>
              <button
                className="btn-file-copy-exec"
                type="button"
                onClick={handleClipboard}
                disabled={copying || isTransferring}
              >
                {copying ? '복사 중…' : `📋 클립보드에 복사 (${targetVideos.length}개 · ${formatFileSize(totalSize)})`}
              </button>
              {copyResult?.success && (
                <div className="fcr-ok">
                  ✅ {copyResult.count}개 클립보드 등록 완료 — 탐색기에서 <kbd>Ctrl+V</kbd>로 붙여넣으세요.
                </div>
              )}
              {copyResult && !copyResult.success && (
                <div className="fcr-err">❌ {copyResult.error}</div>
              )}
            </div>

            <div className="file-copy-divider" />

            {/* ── ② MTP 전송 (모드 선택) ──────────────────── */}
            <div className="file-copy-section">

              {/* 모드 탭 */}
              <div className="mtp-mode-tabs">
                <button
                  className={`mtp-mode-tab${transferMode === 'stable' ? ' mtp-mode-tab--active' : ''}`}
                  type="button"
                  onClick={() => setTransferMode('stable')}
                  disabled={isTransferring}
                >
                  🏆 안정 모드
                  <span className="mtp-mode-badge">권장</span>
                </button>
                <button
                  className={`mtp-mode-tab${transferMode === 'queue' ? ' mtp-mode-tab--active' : ''}`}
                  type="button"
                  onClick={() => setTransferMode('queue')}
                  disabled={isTransferring}
                >
                  🧪 실험 모드
                </button>
              </div>

              {/* ── 안정 모드 ── */}
              {transferMode === 'stable' && (
                <div className="mtp-stable-section">
                  <div className="mtp-stable-desc">
                    <strong>Windows 복사 창에 전송을 위임합니다.</strong><br />
                    모든 파일을 한 번에 Shell에 전달하고 Windows 기본 복사 흐름을 그대로 사용합니다.
                    앱 내부 진행률은 없으며, 실제 전송 상태는 Windows 복사 진행 창에서 확인하세요.
                    <br />
                    <span className="mtp-stable-tip">대용량 파일 전송 시 권장합니다.</span>
                  </div>

                  {bulkStatus === 'done' ? (
                    <div className="mtp-stable-result">
                      <div className="fcr-ok">
                        ✅ 복사가 완료됐습니다. 휴대폰에서 파일을 확인하세요.
                      </div>
                      <button
                        className="btn-file-copy-bulk"
                        type="button"
                        onClick={() => { setBulkStatus(null); handleBulkTransfer() }}
                      >
                        🔄 다시 전송
                      </button>
                    </div>
                  ) : bulkStatus === 'cancelled' ? (
                    <div className="mtp-stable-result">
                      <div className="fcr-err">취소됨 — 다시 시도하려면 아래 버튼을 누르세요.</div>
                      <button
                        className="btn-file-copy-bulk"
                        type="button"
                        onClick={() => { setBulkStatus(null) }}
                      >
                        다시 시도
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn-file-copy-bulk"
                      type="button"
                      onClick={handleBulkTransfer}
                      disabled={isBulkActive || isQueueActive}
                    >
                      {isBulkActive
                        ? '⏳ 전송 중… (Windows 복사 창에서 진행 상황 확인)'
                        : `🪟 안정 모드로 전송 (${targetVideos.length}개 · ${formatFileSize(totalSize)})`}
                    </button>
                  )}
                </div>
              )}

              {/* ── 실험 모드 ── */}
              {transferMode === 'queue' && (
                <div className="mtp-queue-section">
                  <div className="mtp-queue-warning">
                    ⚠️ <strong>실험 모드:</strong> 앱이 파일 큐를 직접 제어합니다.
                    대용량 파일에서 불안정할 수 있습니다. 안정적인 전송에는 안정 모드를 사용하세요.
                  </div>
                  <p className="file-copy-hint file-copy-hint--mtp">
                    폴더 선택 창에서 <strong>이 PC &gt; 휴대폰 폴더</strong>를 선택하면
                    파일이 1개씩 순차 전송됩니다.
                    timeout 발생 시 <strong>일시정지</strong>되고 조치 버튼이 표시됩니다.
                  </p>

                  <button
                    className="btn-file-copy-direct"
                    type="button"
                    onClick={handleStartQueue}
                    disabled={isTransferring || isDone}
                  >
                    {isQueueActive ? '전송 진행 중…' : `📱 큐 모드 전송 (${targetVideos.length}개)`}
                  </button>

                  {transfer.status !== 'idle' && (
                    <div className={`mtp-transfer-box${isNeedsCheck ? ' mtp-transfer-box--paused' : ''}`}>

                      <div className="mtp-transfer-status">
                        <span className="mtp-status-label">{STATUS_LABEL[transfer.status] || transfer.status}</span>
                        <span className="mtp-status-count">
                          성공 <strong>{transfer.doneCount}</strong> ·
                          건너뜀 <strong>{transfer.failedCount}</strong> /
                          전체 <strong>{transfer.total}</strong>
                        </span>
                      </div>

                      {transfer.total > 0 && (
                        <div
                          className="mtp-progress-bar-wrap"
                          role="progressbar"
                          aria-valuenow={progressPercent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className={`mtp-progress-bar${transfer.failedCount > 0 ? ' mtp-progress-bar--partial' : ''}`}
                            style={{ width: `${progressPercent}%` }}
                          />
                          <span className="mtp-progress-pct">{progressPercent}%</span>
                        </div>
                      )}

                      {transfer.currentFileName && (
                        <div className="mtp-current-file" title={transfer.currentFileName}>
                          {transfer.currentFileName}
                          {fileSizeLabel && <span className="mtp-file-size"> ({fileSizeLabel})</span>}
                          {timeoutLabel  && <span className="mtp-file-timeout"> · 최대 {timeoutLabel}</span>}
                        </div>
                      )}

                      {transfer.message && (
                        <div className="mtp-message">{transfer.message}</div>
                      )}

                      {isNeedsCheck && (
                        <div className="mtp-needs-check-panel">
                          <p className="mtp-needs-check-desc">
                            대상 폴더에서 파일이 확인되지 않았습니다.<br />
                            실제로 전송 중이거나 이미 완료됐을 수 있습니다. 조치를 선택해 주세요.
                          </p>
                          <div className="mtp-action-buttons">
                            <button className="btn-mtp-action btn-mtp-continue" onClick={() => sendAction('continue')}>
                              ⏳ 계속 대기
                              <span className="btn-sub">추가 10분 폴링</span>
                            </button>
                            <button className="btn-mtp-action btn-mtp-retry" onClick={() => sendAction('retry')}>
                              🔄 이 파일 재시도
                              <span className="btn-sub">CopyHere 재실행</span>
                            </button>
                            <button className="btn-mtp-action btn-mtp-skip" onClick={() => sendAction('skip')}>
                              ⏭ 이 파일 건너뛰기
                              <span className="btn-sub">다음 파일로 이동</span>
                            </button>
                            <button className="btn-mtp-action btn-mtp-abort" onClick={() => sendAction('abort')}>
                              ⛔ 전체 중단
                              <span className="btn-sub">세션 종료</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {transfer.failedFiles.length > 0 && (
                        <details className="mtp-failed-list">
                          <summary>⚠ 건너뜀 파일 {transfer.failedFiles.length}개 (펼치기)</summary>
                          <ul>
                            {transfer.failedFiles.map((f) => <li key={f} title={f}>{f}</li>)}
                          </ul>
                        </details>
                      )}

                      {isDone && retryFiles?.length > 0 && (
                        <button
                          className="btn-mtp-action btn-mtp-retry-all"
                          type="button"
                          onClick={handleRetryQueue}
                          disabled={isTransferring}
                        >
                          🔄 건너뜀 파일 {retryFiles.length}개 재전송
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
