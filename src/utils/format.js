/**
 * src/utils/format.js
 * 공통 포맷팅 유틸리티 및 상수 정의
 */

// ── 파일 크기 포맷 ─────────────────────────────────────────────
export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '-'
  if (bytes < 1024)                return bytes + ' B'
  if (bytes < 1024 * 1024)         return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024)  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

// ── 날짜 포맷 ─────────────────────────────────────────────────
export function formatDate(isoStr) {
  if (!isoStr) return '-'
  return new Date(isoStr).toLocaleDateString('ko-KR')
}

// ── 상태 레이블 / 스타일 ───────────────────────────────────────
export const STATUS_LABELS = {
  normal:   '일반',
  watched:  '시청완료',
  favorite: '즐겨찾기',
  later:    '나중에',
  missing:  '삭제됨',
}

/** status 값 → badge variant 매핑 */
export const STATUS_VARIANTS = {
  watched:  'watched',
  favorite: 'favorite',
  later:    'later',
  missing:  'missing',
}

// ── 정렬 옵션 목록 ────────────────────────────────────────────
export const SORT_OPTIONS = [
  { value: 'created_desc', label: '최신 추가순' },
  { value: 'updated_desc', label: '최근 수정순' },
  { value: 'rating_desc',  label: '별점 높은순' },
  { value: 'rating_asc',   label: '별점 낮은순' },
  { value: 'recommended',  label: '추천작 우선' },
  { value: 'actor_asc',    label: '배우명순'   },
  { value: 'code_asc',     label: '품번순'     },
  { value: 'random',       label: '랜덤순'     },
]
