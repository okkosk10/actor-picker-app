/**
 * src/components/FileCopyModal.jsx
 * Windows 파일 클립보드 복사 모달 (CF_HDROP 방식)
 *
 * Props:
 *   videos      {Video[]}     - 현재 검색/필터 결과 목록
 *   selectedIds {Set<number>} - 체크박스로 선택된 영상 ID 집합
 *                              (비어있으면 videos 전체를 복사 대상으로 사용)
 *   onClose     {Function}   - 모달 닫기 콜백
 *
 * 동작:
 *   - selectedIds 가 있으면 해당 영상만, 없으면 videos 전체를 복사 대상으로 사용
 *   - missing / deleted 상태 및 file_path 없는 항목 자동 제외
 *   - Windows 탐색기 파일 클립보드(CF_HDROP) 형식으로 복사
 *   - 사용자가 탐색기 또는 MTP 장치 폴더에서 Ctrl+V 하면 파일이 복사됨
 */
import { useMemo, useState, useRef } from 'react'
import { message }                   from 'antd'
import { formatFileSize }            from '../utils/format.js'

export default function FileCopyModal({ videos, selectedIds, onClose }) {
  const overlayRef               = useRef(null)
  const [copying,       setCopying]      = useState(false)
  const [copyResult,    setCopyResult]   = useState(null)
  const [directCopying, setDirectCopying] = useState(false)
  // copyResult: null | { success, count, totalSize, failedPaths, error? }

  // ── 복사 대상 영상 결정 ────────────────────────────────────────
  // selectedIds 가 있으면 선택 항목만, 없으면 전체 결과 사용
  const targetVideos = useMemo(() => {
    const base =
      selectedIds && selectedIds.size > 0
        ? videos.filter((v) => selectedIds.has(v.id))
        : videos
    // missing / deleted 및 file_path 없는 항목 제외
    return base.filter(
      (v) =>
        v.file_path &&
        v.status !== 'missing' &&
        v.status !== 'deleted',
    )
  }, [videos, selectedIds])

  // ── 통계 ───────────────────────────────────────────────────────
  const totalSize = useMemo(
    () => targetVideos.reduce((s, v) => s + (v.size || 0), 0),
    [targetVideos],
  )

  const isSelectionMode = selectedIds && selectedIds.size > 0

  // ── 복사 실행 ──────────────────────────────────────────────────
  const handleCopy = async () => {
    if (targetVideos.length === 0 || copying) return
    setCopying(true)
    setCopyResult(null)

    const filePaths = targetVideos.map((v) => v.file_path)
    try {
      const result = await window.api.copyFilesToClipboard(filePaths)
      setCopyResult(result)
      if (result.success) {
        const sizeStr = formatFileSize(result.totalSize)
        message.success(
          `총 ${result.count}개 파일 / 약 ${sizeStr}가 클립보드에 복사되었습니다.`,
        )
      } else {
        message.error(result.error || '클립보드 복사에 실패했습니다.')
      }
    } catch (err) {
      const errResult = { success: false, error: err.message, count: 0, totalSize: 0, failedPaths: [] }
      setCopyResult(errResult)
      message.error('클립보드 복사 중 오류: ' + err.message)
    } finally {
      setCopying(false)
    }
  }

  // ── 직접 복사 실행 (Shell BrowseForFolder + CopyHere, MTP 장치 지원) ──
  const handleDirectCopy = async () => {
    if (targetVideos.length === 0 || directCopying) return
    setDirectCopying(true)
    setCopyResult(null)

    const filePaths = targetVideos.map((v) => v.file_path)
    try {
      const result = await window.api.copyFilesToDevice(filePaths)
      if (!result.success) {
        if (result.action === 'cancelled') {
          message.info('폴더 선택이 취소되었습니다.')
          return
        }
        message.error(result.error || '직접 복사 실패')
        return
      }
      if (result.action === 'timeout_pending') {
        message.warning(
          `대용량 복사라 완료 확인이 지연되었습니다. Windows 복사 창을 확인하세요. (확인된 파일: ${result.count}/${result.total ?? '?'}개)`,
          6,
        )
        return
      }
      message.success(`✅ ${result.count}개 파일이 휴대폰에 복사되었습니다.`)
    } catch (err) {
      message.error('직접 복사 오류: ' + err.message)
    } finally {
      setDirectCopying(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="파일 클립보드 복사"
    >
      <div className="modal">
        {/* ── 헤더 ──────────────────────────────────────────── */}
        <div className="modal-header">
          <h2 className="modal-title">📂 파일 복사</h2>
          <button
            className="modal-close"
            type="button"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* ── 복사 범위 / 통계 ───────────────────────────────── */}
        <div className="modal-stats">
          <span className="stat-item">
            {isSelectionMode ? '✅ 선택 항목' : '현재 검색 결과 전체'}
          </span>
          <span className="stat-sep">·</span>
          <span className="stat-item">
            복사 대기 <strong>{targetVideos.length}</strong>개
          </span>
          <span className="stat-sep">·</span>
          <span className="stat-item">
            총 용량 <strong>{formatFileSize(totalSize)}</strong>
          </span>
        </div>

        {/* ── 복사 버튼 영역 ─────────────────────────────────── */}
        <div className="file-copy-action">
          {targetVideos.length === 0 ? (
            <p className="modal-empty">
              복사할 파일이 없습니다. (missing / deleted 항목은 제외됩니다)
            </p>
          ) : (
            <>
              <p className="file-copy-hint">
                아래 버튼을 클릭하면 파일이 Windows 클립보드에 등록됩니다.
                이후 Windows 탐색기 또는 MTP 연결 휴대폰 폴더에서{' '}
                <kbd>Ctrl+V</kbd>를 누르면 원본 파일이 해당 위치로 복사됩니다.
              </p>
              <button
                className="btn-file-copy-exec"
                type="button"
                onClick={handleCopy}
                disabled={copying}
              >
                {copying
                  ? '복사 중…'
                  : `📋 클립보드에 복사 (${targetVideos.length}개 · ${formatFileSize(totalSize)})`}
              </button>
              <div className="file-copy-divider" />
              <p className="file-copy-hint file-copy-hint--mtp">
                클립보드 붙여넣기가 휴대폰 폴더에서 안 될 때는 아래 버튼을 사용하세요.
                폴더 선택 창이 열리면 <strong>이 PC &gt; 휴대폰 폴더</strong>를 선택하면 됩니다.
                <br />
                <strong>대용량(수백 GB)도 지원</strong>하며, 전송이 완료될 때까지 버튼이 비활성화 상태로 유지됩니다.
                Windows 복사 진행 창에서 진행 상황을 확인하세요.
              </p>
              <button
                className="btn-file-copy-direct"
                type="button"
                onClick={handleDirectCopy}
                disabled={directCopying}
              >
                {directCopying
                  ? '복사 중… (Windows 복사 창 확인)'
                  : `📱 폴더 선택 후 직접 복사 (MTP 지원)`}
              </button>
            </>
          )}
        </div>

        {/* ── 성공 결과 메시지 ───────────────────────────────── */}
        {copyResult?.success && (
          <div className="file-copy-result file-copy-result--ok">
            <strong>✅ 클립보드 복사 완료</strong>
            <p>
              총 <strong>{copyResult.count}개</strong> 파일 /{' '}
              약 <strong>{formatFileSize(copyResult.totalSize)}</strong>가
              클립보드에 복사되었습니다.
              <br />
              휴대폰 폴더에서 <kbd>Ctrl+V</kbd>로 붙여넣으세요.
            </p>
            {copyResult.failedPaths?.length > 0 && (
              <div className="file-copy-failed">
                <strong>⚠ 존재하지 않아 제외된 파일 ({copyResult.failedPaths.length}개)</strong>
                <ul>
                  {copyResult.failedPaths.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── 실패 결과 메시지 ───────────────────────────────── */}
        {copyResult && !copyResult.success && (
          <div className="file-copy-result file-copy-result--err">
            <strong>❌ 복사 실패</strong>
            <p>{copyResult.error}</p>
            {copyResult.failedPaths?.length > 0 && (
              <div className="file-copy-failed">
                <strong>존재하지 않는 파일 ({copyResult.failedPaths.length}개)</strong>
                <ul>
                  {copyResult.failedPaths.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
