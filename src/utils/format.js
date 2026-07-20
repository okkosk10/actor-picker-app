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

export function formatDateTime(isoStr) {
  if (!isoStr) return '-'
  return new Date(isoStr).toLocaleString('ko-KR')
}

export function getLocalDateKey(isoStr) {
  if (!isoStr) return ''
  const date = new Date(isoStr)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatMonthDay(isoStr) {
  if (!isoStr) return '-'
  const date = new Date(isoStr)
  if (Number.isNaN(date.getTime())) return '-'
  return `${date.getMonth() + 1}.${date.getDate()}`
}

// ── status: 시스템 관리용 (UI 최소 노출) ──────────────────────
// normal  : 정상
// hidden  : 숨김 (향후 확장용)
// missing : 파일 없음 (시스템 자동 설정)
export const STATUS_LABELS = {
  normal:  '정상',
  hidden:  '숨김',
  missing: '삭제됨',
}

// ── grade: 사용자 평가 등급 ────────────────────────────────────
export const GRADES = [
  '영구소장',
  '재시청 추천',
  '만족',
  '보관',
  '애매',
  '삭제요망',
]

/** grade 값 → Ant Design Tag color 매핑 */
export const GRADE_COLORS = {
  '영구소장':   'gold',
  '재시청 추천': 'magenta',
  '만족':      'blue',
  '보관':      'cyan',
  '애매':      'default',
  '삭제요망':   'red',
}

// ── 배우명 파싱 ───────────────────────────────────────────────

/**
 * actor_name 문자열을 쉼표 기준으로 분리하여 배우명 배열로 반환.
 * null / undefined / 빈 문자열은 빈 배열을 반환한다.
 * @param {string|null|undefined} actorName
 * @returns {string[]}
 */
export function parseActors(actorName) {
  if (!actorName || typeof actorName !== 'string') return []
  return actorName.split(',').map((a) => a.trim()).filter(Boolean)
}

/**
 * actor_name 문자열에서 대표 배우(첫 번째)만 반환.
 * 값이 없으면 null을 반환한다.
 * @param {string|null|undefined} actorName
 * @returns {string|null}
 */
export function getPrimaryActor(actorName) {
  const actors = parseActors(actorName)
  return actors[0] ?? null
}

// ── 등급 ↔ 별점 연동 매핑 ────────────────────────────────────
// 등급 변경 시 자동 반영할 별점값
export const RATING_BY_GRADE = {
  '영구소장':   5,
  '재시청 추천': 4,
  '만족':      3,
  '보관':      2,
  '애매':      1,
  '삭제요망':   0,
}

// 별점 변경 시 자동 반영할 등급값
export const GRADE_BY_RATING = {
  5: '영구소장',
  4: '재시청 추천',
  3: '만족',
  2: '보관',
  1: '애매',
  0: '삭제요망',
}

// ── 정렬 옵션 목록 ────────────────────────────────────────────
export const SORT_OPTIONS = [
  { value: 'created_desc', label: '최신 추가순'    },
  { value: 'updated_desc', label: '최근 수정순'    },
  { value: 'subtitle_added_desc', label: '자막 수정일순' },
  { value: 'rating_desc',  label: '별점 높은순'    },
  { value: 'rating_asc',   label: '별점 낮은순'    },
  { value: 'recommended',  label: '추천작 우선'    },
  { value: 'grade_asc',    label: '등급 우선'      },
  { value: 'rec_grade',    label: '추천 + 등급 우선' },
  { value: 'actor_tier_desc', label: '배우 티어 높은순' },
  { value: 'actor_asc',    label: '배우명순'       },
  { value: 'code_asc',     label: '품번순'        },
  { value: 'random',       label: '랜덤순'        },
]

export const ACTOR_TIER_LIMITS = {
  S: 10,
  A: 20,
  B: 30,
}

export const ACTOR_TIER_FILTER_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'S', label: 'S급 배우 작품' },
  { value: 'A_OR_HIGHER', label: 'A급 이상' },
  { value: 'B_OR_HIGHER', label: 'B급 이상' },
  { value: 'UNRANKED_ONLY', label: '무등급 배우 작품' },
]
