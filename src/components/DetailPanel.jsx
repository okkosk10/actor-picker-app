/**
 * src/components/DetailPanel.jsx
 * 선택된 동영상의 상세 정보 표시 및 메타데이터 편집 패널
 *
 * Props:
 *   video        {Video}    - 선택된 동영상 레코드
 *   onUpdate     {Function} - 저장 완료 후 호출 (updatedVideo)
 *   onOpenVideo  {Function} - 파일 열기 콜백 (filePath)
 *   onOpenFolder {Function} - 폴더 열기 콜백 (folderPath)
 *
 * 편집 가능 필드:
 *   recommended, rating, status, tags, memo
 */
import { useState, useEffect } from 'react'
import { Switch, Tag, message } from 'antd'
import StarRating from './StarRating.jsx'
import { useVideoMeta }   from '../hooks/useVideoMeta.js'
import { formatFileSize, formatDate, STATUS_LABELS } from '../utils/format.js'

export default function DetailPanel({ video, onUpdate, onOpenVideo, onOpenFolder }) {
  // ── 편집 필드 로컬 상태 ────────────────────────────────────────
  const [recommended, setRecommended] = useState(Boolean(video.recommended))
  const [recLoading,  setRecLoading]  = useState(false) // Switch 로딩 상태
  const [rating,      setRating]      = useState(video.rating      || 0)
  const [status,      setStatus]      = useState(video.status      || 'normal')
  const [tags,        setTags]        = useState(video.tags        || '')
  const [memo,        setMemo]        = useState(video.memo        || '')

  const { saving, saved, saveVideo, resetSaved } = useVideoMeta()

  // 다른 동영상 선택 시 편집 상태 초기화
  useEffect(() => {
    setRecommended(Boolean(video.recommended))
    setRating(video.rating      || 0)
    setStatus(video.status      || 'normal')
    setTags(video.tags          || '')
    setMemo(video.memo          || '')
    resetSaved()
  }, [video.id, resetSaved])

  // ── 추천 즉시 토글 (updateRecommended API) ─────────────────────
  // Switch 변경 즉시 DB에 반영 — 저장 버튼 불필요
  const handleRecommendedToggle = async (checked) => {
    setRecLoading(true)
    try {
      const updated = await window.api.updateRecommended(video.id, checked ? 1 : 0)
      setRecommended(checked)
      onUpdate(updated) // 부모(목록) 동기화
      message.success(checked ? '추천작으로 등록했습니다.' : '추천 해제했습니다.')
    } catch (e) {
      message.error('추천 변경 실패: ' + e.message)
    } finally {
      setRecLoading(false)
    }
  }

  // ── 저장 처리 ─────────────────────────────────────────────────
  const handleSave = async () => {
    try {
      const updated = await saveVideo(video.id, {
        recommended: recommended ? 1 : 0,
        rating,
        status,
        tags,
        memo,
      })
      onUpdate(updated) // 부모 상태 동기화
    } catch (e) {
      alert('저장 실패: ' + e.message)
    }
  }

  // 태그 목록 파싱 (미리보기용)
  const tagList = tags
    ? tags.split(',').map((t) => t.trim()).filter(Boolean)
    : []

  return (
    <div className="detail-content">
      {/* ── 파일명 ──────────────────────────────────────────────── */}
      <h2 className="detail-filename" title={video.file_name}>
        {video.file_name}
      </h2>

      {/* ── 파일 정보 (읽기 전용) ──────────────────────────────── */}
      <div className="detail-meta">
        <div className="meta-row">
          <span className="meta-label">품번</span>
          <span className="meta-value">{video.code || '-'}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">배우</span>
          <span className="meta-value">{video.actor_name || '-'}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">폴더</span>
          <span className="meta-value meta-path" title={video.folder_path}>
            {video.folder_path}
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-label">크기</span>
          <span className="meta-value">{formatFileSize(video.size)}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">수정일</span>
          <span className="meta-value">{formatDate(video.modified_at)}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">추가일</span>
          <span className="meta-value">{formatDate(video.created_at)}</span>
        </div>
      </div>

      {/* ── 편집 섹션 ───────────────────────────────────────────── */}
      <div className="detail-edit">

        {/* 추천작 토글 — Ant Design Switch */}
        <div className="edit-field edit-field--inline">
          <span className="edit-label">추천작</span>
          <Switch
            checked={recommended}
            onChange={handleRecommendedToggle}
            checkedChildren="⭐ 추천"
            unCheckedChildren="☆ 일반"
            loading={recLoading}
            style={{ background: recommended ? '#f59e0b' : undefined }}
          />
        </div>

        {/* 별점 */}
        <div className="edit-field">
          <span className="edit-label">별점</span>
          <StarRating value={rating} onChange={setRating} />
        </div>

        {/* 상태 */}
        <div className="edit-field">
          <label className="edit-label" htmlFor="dp-status">상태</label>
          <select
            id="dp-status"
            className="edit-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="normal">일반</option>
            <option value="watched">시청완료</option>
            <option value="favorite">즐겨찾기</option>
            <option value="later">나중에</option>
            {/* missing 은 시스템이 자동 설정 — 사용자가 직접 해제할 수는 없으므로 표시만 */}
            {status === 'missing' && <option value="missing">삭제됨 (자동)</option>}
          </select>
        </div>

        {/* 태그 */}
        <div className="edit-field">
          <label className="edit-label" htmlFor="dp-tags">태그</label>
          <input
            id="dp-tags"
            type="text"
            className="edit-input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="쉼표로 구분 (예: 4K, 자막, HD)"
          />
          {/* 태그 미리보기 — Ant Design Tag */}
          {tagList.length > 0 && (
            <div className="tag-preview">
              {tagList.map((t) => (
                <Tag key={t} color="default" style={{ marginBottom: 4 }}>{t}</Tag>
              ))}
            </div>
          )}
        </div>

        {/* 메모 */}
        <div className="edit-field">
          <label className="edit-label" htmlFor="dp-memo">메모</label>
          <textarea
            id="dp-memo"
            className="edit-textarea"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모를 입력하세요..."
            rows={4}
          />
        </div>

        {/* 저장 버튼 */}
        <button
          className="btn-save"
          type="button"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '저장 중…' : saved ? '✓ 저장됨' : '저장'}
        </button>
      </div>

      {/* ── 파일/폴더 열기 버튼 ─────────────────────────────────── */}
      <div className="detail-actions">
        <button
          className="btn-action"
          type="button"
          onClick={() => onOpenVideo(video.file_path)}
          disabled={video.status === 'missing'}
          title={video.status === 'missing' ? '파일이 존재하지 않습니다' : '기본 플레이어로 열기'}
        >
          ▶ 파일 열기
        </button>
        <button
          className="btn-action btn-action--secondary"
          type="button"
          onClick={() => onOpenFolder(video.folder_path)}
        >
          📁 폴더 열기
        </button>
      </div>
    </div>
  )
}
