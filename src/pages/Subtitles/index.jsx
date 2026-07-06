/**
 * src/pages/Subtitles/index.jsx
 * 자막 보관소 전용 페이지
 *
 * - 보관소 경로 선택/저장
 * - 보관소 폴더 열기
 * - 보관소 안의 자막 파일을 영상 폴더로 파일명 기준 보내기
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, message, Modal } from 'antd'
import './Subtitles.css'

export default function SubtitlesPage() {
  const [archivePath, setArchivePath] = useState('')
  const [loadingPath, setLoadingPath] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [lastResult, setLastResult] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const target = await window.api.getSubtitleArchivePath()
        if (alive) setArchivePath(target || '')
      } catch {
        if (alive) setArchivePath('')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const handleChooseArchivePath = useCallback(async () => {
    setLoadingPath(true)
    try {
      const selected = await window.api.selectSubtitleArchivePath()
      if (!selected) return
      setArchivePath(selected)
      message.success('자막 보내기 보관소 경로를 저장했습니다.')
    } catch (err) {
      message.error('보관소 경로 선택 실패: ' + err.message)
    } finally {
      setLoadingPath(false)
    }
  }, [])

  const handleOpenArchive = useCallback(async () => {
    try {
      const target = archivePath || await window.api.getSubtitleArchivePath()
      if (!target) return
      await window.api.openFolder(target)
    } catch (err) {
      message.error('보관소 열기 실패: ' + err.message)
    }
  }, [archivePath])

  const handlePreviewRestore = useCallback(async () => {
    if (previewLoading || restoring) return
    setPreviewLoading(true)
    setLastResult(null)
    try {
      const result = await window.api.previewSubtitleFilesFromArchive()
      setPreviewData(result)
      if (result.success) {
        setPreviewOpen(true)
      } else {
        message.warning(result.error || '보낼 자막이 없습니다.')
      }
    } catch (err) {
      message.error('미리보기 실패: ' + err.message)
    } finally {
      setPreviewLoading(false)
    }
  }, [previewLoading, restoring])

  const handleConfirmRestore = useCallback(async () => {
    if (restoring) return
    setRestoring(true)
    setPreviewOpen(false)
    try {
      const result = await window.api.restoreSubtitleFilesFromArchive()
      setLastResult(result)
      if (result.success) {
        message.success(`자막 ${result.restoredCount}개를 보내고 원본 ${result.removedCount ?? 0}개를 삭제했습니다.`)
      } else {
        message.warning(result.error || '보낼 자막이 없습니다.')
      }
    } catch (err) {
      message.error('자막 보내기 실패: ' + err.message)
    } finally {
      setRestoring(false)
    }
  }, [restoring])

  return (
    <div className="subtitle-page">
      <div className="subtitle-hero">
        <div>
          <div className="subtitle-hero__eyebrow">Subtitle Send Box</div>
          <h2 className="subtitle-hero__title">자막 보내기</h2>
          <p className="subtitle-hero__desc">
            보관소 폴더에 모아둔 자막 파일을 영상 파일명 기준으로 각 작품 폴더에 보내고, 보내기 전에는 경로와 파일명을 미리 확인합니다.
          </p>
        </div>

        <div className="subtitle-hero__actions">
          <button type="button" className="subtitle-btn subtitle-btn--ghost" onClick={handleChooseArchivePath} disabled={loadingPath}>
            {loadingPath ? '선택 중…' : '보내기 보관소 선택'}
          </button>
          <button type="button" className="subtitle-btn" onClick={handleOpenArchive} disabled={!archivePath}>
            보관소 열기
          </button>
          <button type="button" className="subtitle-btn subtitle-btn--primary" onClick={handlePreviewRestore} disabled={previewLoading || restoring || !archivePath}>
            {previewLoading ? '미리보기 중…' : '자막 보내기 미리보기'}
          </button>
        </div>
      </div>

      <div className="subtitle-card">
        <div className="subtitle-card__label">현재 보내기 보관소 경로</div>
        <div className="subtitle-card__path" title={archivePath || '미설정'}>
          {archivePath || '아직 보관소 경로가 설정되지 않았습니다.'}
        </div>
      </div>

      <div className="subtitle-card subtitle-card--info">
        <div className="subtitle-card__title">보내기 기준</div>
        <ul className="subtitle-list">
          <li>보관소 안의 .srt, .smi, .ass 파일만 대상입니다.</li>
          <li>파일명 stem이 같은 영상의 폴더로 복사됩니다.</li>
          <li>같은 파일명이 여러 개면 첫 매칭 영상 폴더가 우선됩니다.</li>
        </ul>
      </div>

      {lastResult && (
        <div className={`subtitle-result ${lastResult.success ? 'subtitle-result--ok' : 'subtitle-result--warn'}`}>
          <div>
            <strong>{lastResult.success ? '보내기 완료' : '보내기 결과'}</strong>
            <div className="subtitle-result__text">
              보냄 {lastResult.restoredCount ?? 0}개 · 삭제 {lastResult.removedCount ?? 0}개 · 미매칭 {lastResult.unmatchedCount ?? 0}개
            </div>
          </div>
          {lastResult.removeFailedCount > 0 && (
            <div className="subtitle-result__files">
              삭제 실패 {lastResult.removeFailedCount}개
            </div>
          )}
          {Array.isArray(lastResult.unmatchedFiles) && lastResult.unmatchedFiles.length > 0 && (
            <div className="subtitle-result__files">
              {lastResult.unmatchedFiles.slice(0, 8).join(', ')}
              {lastResult.unmatchedFiles.length > 8 ? ' 외' : ''}
            </div>
          )}
        </div>
      )}

      <Modal
        open={previewOpen}
        title="자막 보내기 미리보기"
        onCancel={() => setPreviewOpen(false)}
        footer={[
          <Button key="close" onClick={() => setPreviewOpen(false)}>
            취소
          </Button>,
          <Button key="confirm" type="primary" onClick={handleConfirmRestore} loading={restoring}>
            확인하고 보내기
          </Button>,
        ]}
        width={1120}
        centered
      >
        <div className="subtitle-preview-summary">
          <div>보관소 파일 {previewData?.archiveCount ?? 0}개</div>
          <div>매칭 {previewData?.matchedCount ?? 0}개</div>
          <div>미매칭 {previewData?.unmatchedCount ?? 0}개</div>
          <div>보내면 원본도 삭제됨</div>
        </div>

        <div className="subtitle-preview-list">
          {(previewData?.plans || []).slice(0, 30).map((item) => (
            <div key={`${item.sourcePath}-${item.targetPath}`} className="subtitle-preview-item">
              <div className="subtitle-preview-item__source">
                <strong>{item.sourceName}</strong>
                <span>{item.sourceFolder}</span>
              </div>
              <div className="subtitle-preview-item__arrow">→</div>
              <div className="subtitle-preview-item__target">
                <strong>{item.targetFolderName}</strong>
                <span>{item.targetFileName}</span>
              </div>
            </div>
          ))}
        </div>

        {Array.isArray(previewData?.unmatchedFiles) && previewData.unmatchedFiles.length > 0 && (
          <div className="subtitle-preview-unmatched">
            <div className="subtitle-preview-unmatched__title">미매칭 파일</div>
            <div className="subtitle-preview-unmatched__list">
              {previewData.unmatchedFiles.slice(0, 20).join(', ')}
              {previewData.unmatchedFiles.length > 20 ? ' 외' : ''}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}