'use strict'

/**
 * 파일명 파싱 프로필.
 *
 * default:
 *   기존 일반 작품용 규칙을 그대로 유지한다.
 *
 * uncensored-fc2:
 *   FC2, 1Pondo, Caribbeancom 및 한글 제목형 파일을 품번 중심으로
 *   해석한다. 배우 정보가 없는 파일은 정상적인 "미제공" 상태로 둔다.
 */
const PARSER_PROFILES = Object.freeze({
  DEFAULT: 'default',
  UNCENSORED_FC2: 'uncensored-fc2',
})

const PARSER_VERSIONS = Object.freeze({
  [PARSER_PROFILES.DEFAULT]: 1,
  [PARSER_PROFILES.UNCENSORED_FC2]: 1,
})

function normalizeParserProfile(profile) {
  return profile === PARSER_PROFILES.UNCENSORED_FC2
    ? PARSER_PROFILES.UNCENSORED_FC2
    : PARSER_PROFILES.DEFAULT
}

function emptyResult(profile) {
  return {
    code: null,
    actor_name: null,
    actor_candidates: [],
    actor_resolution_status: 'not_provided',
    reference_id: null,
    parser_profile: profile,
    parser_version: PARSER_VERSIONS[profile],
  }
}

function normalizeUncensoredActorName(value) {
  const normalized = String(value || '').trim()
  if (!normalized || /^\d+$/.test(normalized)) return null

  // 분할 파일 표기 때문에 배우명 뒤에 붙은 1, _2, 3 등을 제거한다.
  // 한글이 포함된 이름에만 적용해 숫자가 포함된 영문 활동명을 훼손하지 않는다.
  if (/[가-힣]/.test(normalized)) {
    return normalized.replace(/(?:_\d+|\d+)$/, '').trim() || null
  }
  return normalized
}

function parseActorCandidates(value) {
  return String(value || '')
    .split(/[,，]/)
    .map(normalizeUncensoredActorName)
    .filter(Boolean)
}

function parseBareUncensoredActorName(baseName) {
  let candidate = String(baseName || '')
    .replace(/(?:[_\s-]*노모)$/i, '')
    .trim()

  // 배우명 뒤에 붙은 촬영 장소/상황 설명.
  candidate = candidate.replace(/\s+(?:옷집)$/, '').trim()
  if (!candidate) return null

  // 장르·상황 제목과 코드처럼 보이는 문자열은 배우명으로 만들지 않는다.
  const genericTitles = [
    /^2인$/i,
    /^메이드$/i,
    /^미시$/i,
    /^성우지망생\d*$/i,
    /^웨이브녀$/i,
  ]
  if (genericTitles.some((pattern) => pattern.test(candidate))) return null
  if (/^[A-Za-z]+\d+$/i.test(candidate)) return null

  const koreanTokens = candidate.split(/\s+/).filter(Boolean)
  if (/[가-힣]/.test(candidate) && koreanTokens.length >= 2) return candidate

  const latinTokens = candidate.split(/\s+/).filter(Boolean)
  if (/^[A-Za-z]+(?:\s+[A-Za-z]+)+$/.test(candidate) && latinTokens.length >= 2) {
    return candidate
  }

  return null
}

function normalizePartSuffix(value) {
  if (!value) return ''
  return value
    .split(/[-_]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `_${part}`)
    .join('')
}

function normalizeUncensoredCode(value) {
  const raw = String(value || '').trim()
  if (!raw) return null

  const compact = raw.toUpperCase().replace(/\s+/g, '')

  // FC2-PPV / FC2PPV / FC2P-PV / FC2_번호 표기를 하나로 정규화한다.
  const fc2 = compact.match(/^FC2(?:(P[-_]?PV|[-_]?PPV))?[-_]?(\d{5,8})((?:[-_]\d+)*)$/)
  if (fc2) {
    const hasPpvMarker = Boolean(fc2[1])
    const prefix = hasPpvMarker ? 'FC2-PPV' : 'FC2'
    return `${prefix}-${fc2[2]}${normalizePartSuffix(fc2[3])}`
  }

  const onePondoPrefix = raw.match(/^1pondo\s*[-_]\s*(\d{6})[-_](\d{3})$/i)
  if (onePondoPrefix) return `1PONDO-${onePondoPrefix[1]}_${onePondoPrefix[2]}`

  const onePondoSuffix = raw.match(/^(\d{6})[-_](\d{3})\s*[-_]\s*1pon(?:do)?$/i)
  if (onePondoSuffix) return `1PONDO-${onePondoSuffix[1]}_${onePondoSuffix[2]}`

  const carib = raw.match(/^(\d{6})[-_](\d{3})\s*[-_]\s*carib(?:beancom)?$/i)
  if (carib) return `CARIB-${carib[1]}_${carib[2]}`

  return null
}

function buildProfileResult(profile, values = {}) {
  const actorCandidates = Array.isArray(values.actor_candidates)
    ? values.actor_candidates.filter(Boolean)
    : []

  return {
    ...emptyResult(profile),
    ...values,
    actor_name: actorCandidates.length > 0 ? actorCandidates.join(', ') : null,
    actor_candidates: actorCandidates,
    actor_resolution_status: actorCandidates.length > 0 ? 'candidate' : 'not_provided',
  }
}

function parseUncensoredFileName(fileName) {
  const profile = PARSER_PROFILES.UNCENSORED_FC2
  const baseName = String(fileName || '').replace(/\.[^.]+$/, '').trim()
  if (!baseName) return emptyResult(profile)

  const parenthetical = baseName.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (parenthetical) {
    const rawCode = parenthetical[1].trim()
    const rawActor = parenthetical[2].trim()
    const referenceId = /^\d+$/.test(rawActor) ? rawActor : null
    const actorCandidates = referenceId ? [] : parseActorCandidates(rawActor)

    return buildProfileResult(profile, {
      code: normalizeUncensoredCode(rawCode) || rawCode || null,
      actor_candidates: actorCandidates,
      reference_id: referenceId,
    })
  }

  const specialCode = normalizeUncensoredCode(baseName)
  if (specialCode) {
    return buildProfileResult(profile, { code: specialCode })
  }

  // 표준 품번은 기존 규칙을 재사용한다.
  const standard = parseDefaultFileName(fileName)
  if (standard.code || standard.actor_name) {
    return {
      ...standard,
      parser_profile: profile,
      parser_version: PARSER_VERSIONS[profile],
      actor_resolution_status: standard.actor_name ? 'candidate' : 'not_provided',
    }
  }

  const bareActorName = parseBareUncensoredActorName(baseName)
  if (bareActorName) {
    return buildProfileResult(profile, {
      actor_candidates: [bareActorName],
    })
  }

  return emptyResult(profile)
}

function parseDefaultFileName(fileName) {
  const profile = PARSER_PROFILES.DEFAULT
  const baseName = String(fileName || '').replace(/\.[^.]+$/, '').trim()

  const matchFull = baseName.match(/^(\d*[A-Za-z][A-Za-z0-9\-_]*)\s*\(([^)]+)\)/)
  if (matchFull) {
    const actorName = matchFull[2].trim()
    return {
      ...emptyResult(profile),
      code: matchFull[1].trim().toUpperCase(),
      actor_name: actorName,
      actor_candidates: actorName.split(',').map((name) => name.trim()).filter(Boolean),
      actor_resolution_status: 'candidate',
    }
  }

  const matchCode = baseName.match(/^(\d*[A-Za-z]{2,6}[-_]?\d{3,5})\b/)
  if (matchCode) {
    return {
      ...emptyResult(profile),
      code: matchCode[1].trim().toUpperCase(),
    }
  }

  const matchActorOnly = baseName.match(/^(.+)\(([^)]+)\)\s*$/)
  if (matchActorOnly) {
    const actorName = matchActorOnly[2].trim()
    return {
      ...emptyResult(profile),
      code: matchActorOnly[1].trim() || null,
      actor_name: actorName,
      actor_candidates: actorName.split(',').map((name) => name.trim()).filter(Boolean),
      actor_resolution_status: 'candidate',
    }
  }

  return emptyResult(profile)
}

function parseFileName(fileName, profile = PARSER_PROFILES.DEFAULT) {
  const normalizedProfile = normalizeParserProfile(profile)
  if (normalizedProfile === PARSER_PROFILES.UNCENSORED_FC2) {
    return parseUncensoredFileName(fileName)
  }
  return parseDefaultFileName(fileName)
}

module.exports = {
  PARSER_PROFILES,
  PARSER_VERSIONS,
  normalizeParserProfile,
  normalizeUncensoredActorName,
  normalizeUncensoredCode,
  parseBareUncensoredActorName,
  parseFileName,
}
