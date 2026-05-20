'use strict'

/**
 * electron/parser.cjs
 * 파일명 파싱 모듈
 *
 * 규칙 예시:
 *   SSIS-001(배우명).mp4      → code: 'SSIS-001', actor_name: '배우명'
 *   ABP-123 (홍길동).mkv      → code: 'ABP-123',  actor_name: '홍길동'
 *   STARS-456.avi             → code: 'STARS-456', actor_name: null
 *   기타 파일명.mp4            → code: null,        actor_name: null
 */

/**
 * 파일명에서 품번(code)과 배우명(actor_name)을 추출한다.
 *
 * @param {string} fileName - 확장자를 포함한 원본 파일명
 * @returns {{ code: string|null, actor_name: string|null }}
 */
function parseFileName(fileName) {
  // 확장자 제거 후 앞뒤 공백 정리
  const baseName = fileName.replace(/\.[^.]+$/, '').trim()

  // ── 패턴 1: CODE(배우명) ──────────────────────────────────────
  // 품번은 영문자로 시작하는 영숫자+하이픈 조합
  // 괄호 앞에 공백이 있어도 매칭
  // 예: SSIS-001(배우명) / SSIS-001 (배우명) / stars456(홍길동)
  const matchFull = baseName.match(/^(\d*[A-Za-z][A-Za-z0-9\-_]*)\s*\(([^)]+)\)/)
  if (matchFull) {
    return {
      code:       matchFull[1].trim().toUpperCase(),
      actor_name: matchFull[2].trim(),
    }
  }

  // ── 패턴 2: CODE만 존재 (괄호 없음) ────────────────────────────
  // 예: SSIS-001.mp4 / ABP123.mkv
  const matchCode = baseName.match(/^(\d*[A-Za-z]{2,6}[-_]?\d{3,5})\b/)
  if (matchCode) {
    return {
      code:       matchCode[1].trim().toUpperCase(),
      actor_name: null,
    }
  }

  // ── 패턴 3: 일반 작품명(배우명) fallback ───────────────────────────
  // CODE 패턴이 없는 경우에도 파일명 끝 괄호에서 배우명을 추출한다.
  // 예: 교복(Anastangel) → { code: null, actor_name: 'Anastangel' }
  // 예: 교복_2(Anastangel) → { code: null, actor_name: 'Anastangel' }
  const matchActorOnly = baseName.match(/^(.+)\(([^)]+)\)\s*$/)
  if (matchActorOnly) {
    return {
      code:       matchActorOnly[1].trim() || null,
      actor_name: matchActorOnly[2].trim(),
    }
  }

  // ── 파싱 불가 ───────────────────────────────────────────────────
  return { code: null, actor_name: null }
}

module.exports = { parseFileName }
