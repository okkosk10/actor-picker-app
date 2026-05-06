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
 * 편집 가능 필드 (즉시 저장):
 *   recommended  : Switch 토글 → updateRecommended API
 *   grade        : Select 변경 → updateGrade API
 *
 * 편집 가능 필드 (저장 버튼):
 *   rating, tags, memo
 *
 * status 는 시스템 관리용 — UI에서 직접 편집 불가 (missing 표시만)
 */
import { useState, useEffect } from 'react'
import { Switch, Tag, Select, message } from 'antd'
import StarRating from './StarRating.jsx'
import { useVideoMeta } from '../hooks/useVideoMeta.js'
import { formatFileSize, formatDate, GRADES, GRADE_COLORS, STATUS_LABELS, RATING_BY_GRADE, GRADE_BY_RATING } from '../utils/format.js'

const { Option } = Select

/**
 * 신규 영상(is_new=1)이고 rating이 미설정(0)인 경우에만
 * grade 매핑으로 초기 별점을 결정한다.
 * 기존 데이터(is_new=0)나 이미 별점이 있는 경우는 원본 값을 그대로 반환한다.
 */
function getInitialRating(v) {
  if (v.is_new === 1 && !v.rating) {
    return RATING_BY_GRADE[v.grade || '보관'] ?? 0
  }
  return v.rating || 0
}

export default function DetailPanel({ video, onUpdate, onOpenVideo, onOpenFolder }) {
  // ── 즉시 저장 필드 상태 ───────────────────────────────────────
  const [recommended, setRecommended] = useState(Boolean(video.recommended))
  const [recLoading,  setRecLoading]  = useState(false)
  const [grade,       setGrade]       = useState(video.grade || '보관')
  const [gradeLoading, setGradeLoading] = useState(false)

  // ── 저장 버튼 필드 상태 ───────────────────────────────────────
  const [rating, setRating] = useState(getInitialRating(video))
  const [tags,   setTags]   = useState(video.tags   || '')
  const [memo,   setMemo]   = useState(video.memo   || '')

  const { saving, saved, saveVideo, resetSaved } = useVideoMeta()

  // 다른 동영상 선택 시 편집 상태 초기화
  useEffect(() => {
    setRecommended(Boolean(video.recommended))
    setGrade(video.grade || '보관')
    setRating(getInitialRating(video))
    setTags(video.tags   || '')
    setMemo(video.memo   || '')
    resetSaved()
  }, [video.id, resetSaved])

  // ── 추천 즉시 토글 ─────────────────────────────────────────────
  const handleRecommendedToggle = async (checked) => {
    setRecLoading(true)
    try {
      const updated = await window.api.updateRecommended(video.id, checked ? 1 : 0)
      setRecommended(checked)
      onUpdate(updated)
      message.success(checked ? '추천작으로 등록했습니다.' : '추천 해제했습니다.')
    } catch (e) {
      message.error('추천 변경 실패: ' + e.message)
    } finally {
      setRecLoading(false)
    }
  }

  // ── 등급 즉시 변경 (rating·recommended 자동 연동) ────────────
  const handleGradeChange = async (newGrade) => {
    setGradeLoading(true)
    try {
      const newRating      = RATING_BY_GRADE[newGrade] ?? rating
      // 영구소장이면 추천작 자동 true, 그 외는 현재 값 유지
      const newRecommended = newGrade === '영구소장' ? true : recommended
      const updated = await window.api.updateGrade(video.id, {
        grade:       newGrade,
        rating:      newRating,
        recommended: newRecommended ? 1 : 0,
      })
      setGrade(newGrade)
      setRating(newRating)
      if (newGrade === '영구소장') setRecommended(true)
      onUpdate(updated)
      message.success(`등급을 "${newGrade}"(으)로 변경했습니다.`)
    } catch (e) {
      message.error('등급 변경 실패: ' + e.message)
    } finally {
      setGradeLoading(false)
    }
  }

  // ── 별점 변경 (grade·recommended 자동 연동, 로컬 상태만 반영) ─
  // 저장은 기존과 동일하게 저장 버튼 클릭 시 handleSave 에서 처리됨
  const handleRatingChange = (newRating) => {
    const newGrade = GRADE_BY_RATING[newRating] ?? grade
    setRating(newRating)
    setGrade(newGrade)
    if (newRating === 5) setRecommended(true)
  }

  // ── 저장 버튼 처리 (rating, tags, memo) ─────────────────────
  const handleSave = async () => {
    try {
      // recommended / grade 는 이미 즉시 저장됨 → 현재 상태 그대로 전달
      const updated = await saveVideo(video.id, {
        recommended: recommended ? 1 : 0,
        grade,
        rating,
        tags,
        memo,
        // status 는 시스템 관리용 — 사용자 편집 불가, 현재 값 보존
        status: video.status,
      })
      onUpdate(updated)
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
        {/* missing 상태일 때만 경고 표시 */}
        {video.status === 'missing' && (
          <div className="meta-row">
            <span className="meta-label">상태</span>
            <Tag color="red">⚠ 파일 없음</Tag>
          </div>
        )}
      </div>

      {/* ── 편집 섹션 ───────────────────────────────────────────── */}
      <div className="detail-edit">

        {/* 추천작 토글 — 즉시 저장 */}
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

        {/* 등급 Select — 즉시 저장 */}
        <div className="edit-field edit-field--inline">
          <span className="edit-label">등급</span>
          <Select
            value={grade}
            onChange={handleGradeChange}
            loading={gradeLoading}
            size="small"
            style={{ minWidth: 130 }}
          >
            {GRADES.map((g) => (
              <Option key={g} value={g}>
                <Tag color={GRADE_COLORS[g]} style={{ margin: 0 }}>{g}</Tag>
              </Option>
            ))}
          </Select>
        </div>

        {/* 별점 */}
        <div className="edit-field">
          <span className="edit-label">별점</span>
          <StarRating value={rating} onChange={handleRatingChange} />
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
          {/* 태그 미리보기 */}
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

        {/* 저장 버튼 + 파일/폴더 열기 — 한 줄 */}
        <div className="detail-save-row">
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
          <button
            className="btn-save"
            type="button"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '저장 중…' : saved ? '✓ 저장됨' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

