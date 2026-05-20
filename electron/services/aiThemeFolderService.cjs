'use strict'

/**
 * electron/services/aiThemeFolderService.cjs
 * DB 영상 후보를 OpenAI에 전달해 "특집 테마 폴더" 제안을 받는다.
 *
 * 보안:
 *   - API Key는 openaiClient.cjs에서만 관리하며 renderer로 전달하지 않는다.
 *   - AI는 제안만 한다. 파일 조작은 이 모듈에서 수행하지 않는다.
 */

const path = require('path')
const { getOpenAIClient }     = require('./openaiClient.cjs')
const { buildThemeCandidates } = require('./themeCandidateService.cjs')
const { parseTargetSizeGB, redistributeBySize: _redistributeBySize } = require('./themeSizeHelper.cjs')

// ─────────────────────────────────────────────────────────────
// 폴더명 정제
// ─────────────────────────────────────────────────────────────

/**
 * Windows 파일 시스템에서 사용 가능한 폴더명으로 정제한다.
 * @param {string} name
 * @returns {string}
 */
function sanitizeFolderName(name) {
  if (!name || typeof name !== 'string') return 'AI_특집'

  let s = name
    // Windows 금지 문자 제거
    .replace(/[<>:"/\\|?*]/g, ' ')
    // 앞뒤 공백 제거
    .trim()
    // 연속 공백 → 단일 언더스코어
    .replace(/\s+/g, '_')
    // 연속 언더스코어 → 단일
    .replace(/_+/g, '_')
    // 앞뒤 언더스코어 정리
    .replace(/^_|_$/g, '')

  if (!s) s = 'AI_특집'

  // 60자 초과 시 자르기
  if (s.length > 60) s = s.slice(0, 60).replace(/_$/, '')

  // 날짜 접미사 추가
  const today = new Date()
  const yyyy  = today.getFullYear()
  const mm    = String(today.getMonth() + 1).padStart(2, '0')
  const dd    = String(today.getDate()).padStart(2, '0')
  return `${s}_${yyyy}${mm}${dd}`
}

// ─────────────────────────────────────────────────────────────
// 용량 기준 재분배 래퍼 (sanitizeFolderName 주입)
// ─────────────────────────────────────────────────────────────

/**
 * redistributeBySize에 이 파일의 sanitizeFolderName을 주입한 래퍼.
 * @param {object[]} themes
 * @param {Map}      videoMap
 * @param {number}   targetSizeGB
 * @returns {object[]}
 */
function redistributeBySize(themes, videoMap, targetSizeGB) {
  return _redistributeBySize(themes, videoMap, targetSizeGB, sanitizeFolderName)
}

// ─────────────────────────────────────────────────────────────
// AI 응답 검증
// ─────────────────────────────────────────────────────────────

/**
 * AI가 반환한 themeFolders 배열을 검증 및 보강한다.
 *
 * @param {object[]} themeFolders - AI 응답의 themeFolders
 * @param {object[]} allVideos    - DB에서 조회한 전체 영상 DTO 배열 (점수 포함)
 * @param {Map}      videoMap     - id → 영상 DTO Map (filePath 포함)
 * @returns {object[]} 검증된 테마 배열
 */
function validateAiThemeFolders(themeFolders, allVideos, videoMap) {
  if (!Array.isArray(themeFolders)) return []

  const validThemes = []

  for (const theme of themeFolders) {
    if (!theme || typeof theme !== 'object') continue

    // videoIds 정제
    const rawIds   = Array.isArray(theme.videoIds) ? theme.videoIds : []
    const validIds = [...new Set(
      rawIds
        .map(id => Number(id))
        .filter(id => {
          if (!videoMap.has(id)) return false
          const v = videoMap.get(id)
          return v.filePath && v.filePath !== ''
        })
    )]

    if (validIds.length < 2) continue

    // 기본값 보완
    const title      = theme.title       ?? 'AI 특집'
    const folderName = sanitizeFolderName(theme.folderName ?? title)
    const confidence = typeof theme.confidence === 'number' ? theme.confidence : 0.5

    // 통계 계산
    let totalSize    = 0
    let ratingSum    = 0
    let themeScoreSum = 0
    for (const id of validIds) {
      const v = videoMap.get(id)
      totalSize     += (v.fileSize ?? 0)
      ratingSum     += (Number(v.rating) || 0)
      themeScoreSum += (Number(v.themeScore) || 0)
    }
    const count      = validIds.length
    const totalSizeGB = Number((totalSize / 1073741824).toFixed(2))
    const avgRating   = count > 0 ? Number((ratingSum / count).toFixed(2)) : 0
    const avgThemeScore = count > 0 ? Math.round(themeScoreSum / count) : 0

    validThemes.push({
      title,
      folderName,
      description:  theme.description  ?? '',
      keywords:     Array.isArray(theme.keywords)    ? theme.keywords    : [],
      actorNames:   Array.isArray(theme.actorNames)  ? theme.actorNames  : [],
      videoIds:     validIds,
      reason:       theme.reason       ?? '',
      confidence,
      itemCount:    count,
      totalSizeGB,
      avgRating,
      avgThemeScore,
    })
  }

  return validThemes
}

// ─────────────────────────────────────────────────────────────
// 메인 진입점
// ─────────────────────────────────────────────────────────────

/**
 * DB 영상 데이터를 기반으로 OpenAI에게 특집 테마 폴더를 제안 받는다.
 *
 * @param {object[]} videos    - DB에서 조회한 전체 영상 DTO 배열 (filePath 포함)
 * @param {object}   [options]
 * @param {number}   [options.candidateLimit=120] - AI에게 전달할 후보 수
 * @returns {Promise<{ success: true, themes: object[], candidateCount: number }
 *                 | { success: false, error: string }>}
 */
async function generateAiThemeFolders(videos, options = {}) {
  const { candidateLimit = 120, customPrompt = '', priorityIds = new Set(), forcedTheme = null } = options
  const targetSizeGB = parseTargetSizeGB(customPrompt)

  // 1. 후보 계산
  const candidates = buildThemeCandidates(videos, candidateLimit, priorityIds)
  if (candidates.length === 0) {
    return { success: false, error: '후보 영상이 없습니다.' }
  }

  // 2. id → DTO 맵 (videoMap에는 filePath도 포함해야 하므로 원본 videos를 사용)
  const videoMap = new Map()
  for (const v of videos) {
    const dto = {
      id:          Number(v.id),
      fileName:    v.fileName    ?? v.file_name    ?? '',
      filePath:    v.filePath    ?? v.file_path    ?? '',
      folderName:  v.folderName  ?? v.folder_name  ?? '',
      actors:      v.actors      ?? v.actor_name   ?? '',
      tags:        Array.isArray(v.tags) ? v.tags : [],
      actorTags:   Array.isArray(v.actorTags) ? v.actorTags : [],
      rating:      v.rating      ?? 0,
      grade:       v.grade       ?? '',
      playCount:   v.playCount   ?? v.play_count   ?? 0,
      copyCount:   v.copyCount   ?? v.copy_count   ?? 0,
      fileSize:    v.fileSize    ?? v.file_size    ?? 0,
      themeScore:  0,
    }
    videoMap.set(Number(v.id), dto)
  }
  // themeScore 보강
  for (const c of candidates) {
    const entry = videoMap.get(c.id)
    if (entry) entry.themeScore = c.themeScore
  }

  // 3. AI 호출
  const client = getOpenAIClient()
  const model  = process.env.OPENAI_MODEL || 'gpt-4.1'

  const systemPrompt = `당신은 영상 라이브러리 큐레이터입니다.
사용자의 영상 컬렉션을 분석해 테마가 있는 특집 폴더를 제안하는 것이 당신의 역할입니다.

규칙:
- 아래 후보는 로컬 점수 계산(watchScore, copyScore, themeScore)으로 선별된 우수 후보들입니다.
- tags, actorTags, actors, folderName, fileName, rating, playCount, copyCount를 종합해 테마를 만드세요.
- 단순 점수 높은 순이 아닌, 테마성이 있는 묶음을 만드세요 (배우 계열, 태그 계열, 폴더/시리즈 계열 등).
- 후보 목록 끝에는 순환 다양성을 위한 낮은 점수의 탐색 후보 1개가 포함됩니다. 테마에 어울린다면 이 항목도 적극 활용해 새로운 발견 기회를 만드세요.
- 테마명은 사용자가 폴더명으로 쓰기 좋은 한국어 이름으로 만드세요.
- 각 특집은 최소 2개, 최대 30개 videoId를 포함하세요. 단, 사용자가 '싹다', '모두', '전부'처럼 전체 포함을 요청한 경우에는 30개 제한보다 전체 포함을 우선하세요.
- 같은 videoId가 너무 많은 테마에 중복되지 않게 하세요.
- **배우 다양성**: 특정 배우 한 명을 주제로 하는 테마는 전체 테마 중 최대 1개로 제한하세요. 같은 배우가 여러 테마에 반복 등장하지 않도록 하세요.
- 전체 테마에 걸쳐 가능한 다양한 배우, 태그, 폴더 계열이 골고루 나오도록 하세요.
- 성인물 직접 묘사는 피하고 앱 내부 정리용 테마/태그 수준으로 표현하세요.
- [사용자 요청]이 있으면 그 내용을 최우선으로 반영하세요. 요청에 명시된 배우나 태그가 반드시 포함되어야 합니다.
- **중요**: '싹다', '모두', '전부' 등 전체 포함 요청이 있으면 조건에 맞는 영상을 최대한 하나의 큰 폴더에 모아 주세요. '배우당 N개씩' 요청은 배우마다 별도 폴더를 만들지 말고, 하나의 폴더 안에 각 배우에서 N개씩 골라 포함하세요.${
    targetSizeGB
      ? `\n- **용량 기준 묶기 (최우선)**: 사용자가 ${targetSizeGB}GB 단위 묶기를 요청했습니다.\n  - **중요**: ${targetSizeGB}는 영상 개수(개수)가 아니라 GB 용량입니다. videoIds를 선택할 때 각 영상의 fileSizeGB를 직접 합산해서 총합이 ${targetSizeGB}GB 이하가 되도록 하세요.\n  - 각 themeFolder의 videoIds에 포함된 영상들의 fileSizeGB 합계가 반드시 ${targetSizeGB}GB 이하가 되어야 합니다.\n  - 가능하면 각 폴더를 ${targetSizeGB}GB의 80~100% 범위(${(targetSizeGB * 0.8).toFixed(1)}~${targetSizeGB}GB)로 채우세요.\n  - 용량 초과가 될 것 같으면 여러 개의 themeFolder로 나눠서 반환하세요. 하나의 폴더에 모두 넣으려 하지 마세요.\n  - 테마 일관성보다 용량 제한이 우선입니다.\n  - 같은 videoId 중복 금지.\n  - 용량을 맞추기 어려우면 마지막 폴더만 작아도 됩니다.`
      : ''
  }
- **출력 규칙**: 반드시 JSON 객체 하나만 반환하세요. 그 외 어떤 텍스트(설명, 주석, 마크다운)도 절대 출력하지 마세요.

응답 형식 (JSON 객체 하나만, 다른 텍스트 없이):
{
  "themeFolders": [
    {
      "title": "테마 제목",
      "folderName": "폴더명_한글_가능",
      "description": "테마 설명",
      "keywords": ["키워드1", "키워드2"],
      "actorNames": ["배우A", "배우B"],
      "videoIds": [1, 2, 3, 4, 5],
      "reason": "이 영상들을 묶은 이유",
      "confidence": 0.85
    }
  ]
}`

  // AI 테마 분류에 필요한 필드만 남겨 토큰 절감 (watchScore, copyScore 등 내부 점수 제거)
  const slimCandidates = candidates.map(({ id, fileName, folderName, parentFolderName, actors, tags, actorTags, rating, playCount, copyCount, favorite, grade, themeScore, fileSizeGB }) => ({
    id, fileName, folderName, parentFolderName, actors, tags, actorTags, rating, playCount, copyCount, favorite, grade, themeScore, fileSizeGB
  }))

  // 문자 수 기반 동적 트런케이션
  // 일본어 1자 ≈ 1토큰 → 20,000자 이하 유지 시 후보 토큰 ≤ 20,000
  // 시스템 프롬프트 ~2,000토큰 + 후보 ≤ 20,000 = 총 ≤ 22,000토큰 (30k 한도 이내)
  const CANDIDATE_CHAR_BUDGET = 20000
  const cappedCandidates = []
  let charCount = 2 // JSON 배열 [] 포함
  for (const c of slimCandidates) {
    const s = JSON.stringify(c)
    if (charCount + s.length + 1 > CANDIDATE_CHAR_BUDGET) break
    cappedCandidates.push(c)
    charCount += s.length + 1
  }

  const userPromptBase = `다음은 내 영상 라이브러리의 상위 ${cappedCandidates.length}개 후보입니다. 특집 폴더를 제안해주세요.\n\n${JSON.stringify(cappedCandidates)}`
  const userPrompt = customPrompt
    ? `[사용자 요청] ${customPrompt}\n\n${userPromptBase}`
    : userPromptBase

  let rawText = ''
  try {
    const response = await client.responses.create({
      model,
      // customPrompt 있으면 정확도 우선(0.7), 없으면 다양성 우선(1.1)
      temperature:  customPrompt ? 0.7 : 1.1,
      instructions: systemPrompt,
      input:        userPrompt,
      // JSON 모드 강제: 순수 JSON 객체만 반환
      text: { format: { type: 'json_object' } },
    })
    rawText = response.output_text?.trim() ?? ''
  } catch (err) {
    // JSON 모드 미지원 모델이면 폴백 (json_object 없이 재시도)
    if (err.message?.includes('text.format') || err.message?.includes('json_object')) {
      try {
        const response2 = await client.responses.create({
          model,
          temperature:  customPrompt ? 0.7 : 1.1,
          instructions: systemPrompt,
          input:        userPrompt,
        })
        rawText = response2.output_text?.trim() ?? ''
      } catch (err2) {
        return { success: false, error: `OpenAI 요청 실패: ${err2.message}` }
      }
    } else {
      return { success: false, error: `OpenAI 요청 실패: ${err.message}` }
    }
  }

  // 4. JSON 파싱 (마크다운 블록 + 앞뒤 설명 문장 + 인라인 주석 제거)
  let parsed
  try {
    let jsonStr = rawText

    // ① 마크다운 코드 블록 제거
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    // ② 앞에 설명 문장이 붙어 있을 경우 첫 { 부터 추출
    const firstBrace = jsonStr.indexOf('{')
    if (firstBrace > 0) jsonStr = jsonStr.slice(firstBrace)

    // ③ 뒤에 불필요한 텍스트가 붙어 있을 경우 마지막 } 까지만
    const lastBrace = jsonStr.lastIndexOf('}')
    if (lastBrace !== -1 && lastBrace < jsonStr.length - 1) jsonStr = jsonStr.slice(0, lastBrace + 1)

    // ④ 문자열 리터럴 밖의 // 주석 제거 (AI가 videoIds 줄에 달곤 함)
    jsonStr = jsonStr.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (m, str) => str ?? '')

    parsed = JSON.parse(jsonStr)
  } catch (_) {
    // 파싱 실패 시 원문 일부를 개발 콘솔에만 출력 (API Key 포함 안 됨)
    console.error('[aiThemeFolderService] JSON 파싱 실패. 원문 앞 500자:', rawText.slice(0, 500))
    return { success: false, error: 'AI 응답 JSON 파싱에 실패했습니다.' }
  }

  if (!parsed || !Array.isArray(parsed.themeFolders)) {
    console.error('[aiThemeFolderService] 예상 형식이 아님:', JSON.stringify(parsed).slice(0, 300))
    return { success: false, error: 'AI 응답 형식이 올바르지 않습니다.' }
  }

  // 5. 검증 및 보강
  let themes = validateAiThemeFolders(parsed.themeFolders, videos, videoMap)
  if (forcedTheme) {
    const forcedThemes = validateAiThemeFolders([forcedTheme], videos, videoMap)
    if (forcedThemes.length > 0) {
      const forcedIds = new Set(forcedThemes[0].videoIds)
      themes = [
        forcedThemes[0],
        ...themes.filter(theme =>
          theme.videoIds.length !== forcedIds.size ||
          theme.videoIds.some(id => !forcedIds.has(id))
        ),
      ]
    }
  }
  if (themes.length === 0) {
    return { success: false, error: 'AI 응답에서 유효한 테마를 찾을 수 없습니다.' }
  }

  // 6. 용량 기준 사후 재분배 (targetSizeGB가 있을 때만)
  if (targetSizeGB) {
    // 첫 번째 테마의 첫 5개 비디오 fileSize 샘플 로그
    const sampleTheme = themes[0]
    if (sampleTheme) {
      const sampleIds = sampleTheme.videoIds.slice(0, 5)
      const sampleSizes = sampleIds.map(id => {
        const v = videoMap.get(id)
        return `id=${id} fileSize=${v?.fileSize}`
      })
      console.log(`[aiThemeFolderService] 첫 테마 샘플 fileSize:`, sampleSizes)
    }
    console.log(`[aiThemeFolderService] redistributeBySize 호출: targetSizeGB=${targetSizeGB}, 테마 수=${themes.length}, 테마별 totalSizeGB=${themes.map(t => t.totalSizeGB).join(',')}`)
    themes = redistributeBySize(themes, videoMap, targetSizeGB)
    console.log(`[aiThemeFolderService] redistributeBySize 완료: 결과 테마 수=${themes.length}, 테마별 totalSizeGB=${themes.map(t => t.totalSizeGB).join(',')}`)
  }

  // videoMap을 plain object로 변환해 IPC 직렬화 가능하게 반환
  const videoMapObj = {}
  for (const [id, dto] of videoMap) videoMapObj[id] = dto

  return { success: true, themes, candidateCount: candidates.length, videoMap: videoMapObj }
}

module.exports = { generateAiThemeFolders, sanitizeFolderName, validateAiThemeFolders, parseTargetSizeGB, redistributeBySize }
