'use strict'

/**
 * electron/services/themeSizeHelper.cjs
 *
 * 용량 기반 폴더 묶기에 관한 순수 함수들.
 * Electron/OpenAI 의존성이 없어 Node.js 단독 테스트 가능.
 */

// ─────────────────────────────────────────────────────────────
// 용량 파싱
// ─────────────────────────────────────────────────────────────

/**
 * customPrompt에서 "N GB씩", "N기가 단위", "N GB 이하" 같은 용량 기준을 파싱한다.
 *
 * 지원 패턴 (대소문자 무시):
 *   "30GB씩", "30 GB씩", "30기가씩", "30기가 단위",
 *   "50GB 이하", "50기가 이하", "100기가 단위로 폴더",
 *   "핸드폰에 넣기 좋게 40GB 이하"
 *
 * @param {string} prompt
 * @returns {number|null} GB 숫자 (소수점 허용), 없으면 null
 */
function parseTargetSizeGB(prompt) {
  if (!prompt || typeof prompt !== 'string') return null
  // 숫자(정수 또는 소수) + 선택적 공백 + 단위(gb/기가바이트/기가/g)
  const re = /(\d+(?:\.\d+)?)\s*(?:기가바이트|기가|gb|gib|g(?=\b))/i
  const m = prompt.match(re)
  if (!m) return null
  const val = parseFloat(m[1])
  return isFinite(val) && val > 0 ? val : null
}

// ─────────────────────────────────────────────────────────────
// 용량 기준 사후 재분배
// ─────────────────────────────────────────────────────────────

/**
 * AI가 반환한 테마들을 targetSizeGB 기준으로 재분배한다.
 *
 * - 각 테마의 totalSizeGB ≤ targetSizeGB 가 되도록 보장
 * - 초과하는 테마는 "파트 1", "파트 2"로 나눔
 * - targetSizeGB가 없거나 ≤ 0 이면 원본 그대로 반환
 *
 * @param {object[]} themes      - validateAiThemeFolders 반환값
 * @param {Map}      videoMap    - id → 영상 DTO Map (fileSize, rating, themeScore 포함)
 * @param {number}   targetSizeGB
 * @param {Function} sanitizeFn  - 폴더명 정제 함수 (aiThemeFolderService의 sanitizeFolderName)
 * @returns {object[]}
 */
function redistributeBySize(themes, videoMap, targetSizeGB, sanitizeFn) {
  if (!targetSizeGB || targetSizeGB <= 0) return themes

  const sanitize = typeof sanitizeFn === 'function' ? sanitizeFn : (s) => s

  const result = []

  for (const theme of themes) {
    // 이미 기준 이하면 그대로
    if (theme.totalSizeGB <= targetSizeGB) {
      result.push(theme)
      continue
    }

    // 초과 → videoIds를 순서대로 담아 targetSizeGB마다 분할
    const parts   = []
    let curPart   = []
    let curSizeGB = 0

    for (const id of theme.videoIds) {
      const v      = videoMap.get(id)
      const sizeGB = v?.fileSize ? Number((v.fileSize / 1073741824).toFixed(2)) : 0

      // 현재 파트가 비어 있으면 무조건 추가 (단일 영상이 targetSizeGB 초과해도 담음)
      if (curPart.length === 0) {
        curPart.push(id)
        curSizeGB = sizeGB
      } else if (curSizeGB + sizeGB <= targetSizeGB) {
        curPart.push(id)
        curSizeGB += sizeGB
      } else {
        parts.push({ ids: curPart, sizeGB: curSizeGB })
        curPart   = [id]
        curSizeGB = sizeGB
      }
    }
    if (curPart.length > 0) parts.push({ ids: curPart, sizeGB: curSizeGB })

    // 분할 결과가 1개면 그냥 원본 유지
    if (parts.length === 1) {
      result.push(theme)
      continue
    }

    // 날짜 접미사 제거한 기본 folderName 추출
    const baseFolderName = theme.folderName.replace(/_\d{8}$/, '')

    for (let i = 0; i < parts.length; i++) {
      const { ids: partIds } = parts[i]
      let partSizeBytes = 0
      let ratingSum     = 0
      let themeScoreSum = 0

      for (const id of partIds) {
        const v = videoMap.get(id)
        if (v) {
          partSizeBytes += (v.fileSize ?? 0)
          ratingSum     += (Number(v.rating) || 0)
          themeScoreSum += (Number(v.themeScore) || 0)
        }
      }

      const count         = partIds.length
      const totalSizeGB   = Number((partSizeBytes / 1073741824).toFixed(2))
      const avgRating     = count > 0 ? Number((ratingSum / count).toFixed(2)) : 0
      const avgThemeScore = count > 0 ? Math.round(themeScoreSum / count) : 0
      const partLabel     = `파트_${i + 1}`
      const partTitle     = `${theme.title} 파트 ${i + 1}`
      const partFolderName = sanitize(`${baseFolderName}_${partLabel}`)

      result.push({
        title:        partTitle,
        folderName:   partFolderName,
        description:  theme.description ? `${theme.description} (파트 ${i + 1})` : `파트 ${i + 1}`,
        keywords:     theme.keywords,
        actorNames:   theme.actorNames,
        videoIds:     partIds,
        reason:       theme.reason,
        confidence:   theme.confidence,
        itemCount:    count,
        totalSizeGB,
        avgRating,
        avgThemeScore,
      })
    }
  }

  return result
}

module.exports = { parseTargetSizeGB, redistributeBySize }
