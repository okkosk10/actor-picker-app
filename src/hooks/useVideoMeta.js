/**
 * src/hooks/useVideoMeta.js
 * 동영상 메타데이터 저장 커스텀 훅
 *
 * DetailPanel 내부에서 사용.
 * 저장 중(saving) / 저장 완료(saved) 상태를 관리하고,
 * window.api.updateVideoMeta 호출을 래핑한다.
 *
 * 사용 예:
 *   const { saving, saved, saveVideo } = useVideoMeta()
 *   await saveVideo(video.id, { memo, tags, rating, status, recommended })
 */

import { useState, useCallback } from 'react'

export function useVideoMeta() {
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  /**
   * 동영상 메타데이터를 저장한다.
   *
   * @param {number} id   - videos.id
   * @param {object} data - { memo, tags, rating, status, recommended }
   * @returns {Promise<Video>} 업데이트된 Video 레코드
   * @throws {Error} API 호출 실패 시
   */
  const saveVideo = useCallback(async (id, data) => {
    setSaving(true)
    setSaved(false)
    try {
      const updated = await window.api.updateVideoMeta(id, data)
      setSaved(true)
      // 2초 후 저장 완료 표시 자동 숨김
      setTimeout(() => setSaved(false), 2000)
      return updated
    } finally {
      setSaving(false)
    }
  }, [])

  /** 선택 영상이 바뀌면 저장 상태 초기화 (외부에서 호출) */
  const resetSaved = useCallback(() => {
    setSaved(false)
  }, [])

  return { saving, saved, saveVideo, resetSaved }
}
