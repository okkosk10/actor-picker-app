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

    if (validIds.length < 3) continue

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
  const { candidateLimit = 120, customPrompt = '', priorityIds = new Set() } = options

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
- tags, actors, folderName, fileName, rating, playCount, copyCount를 종합해 테마를 만드세요.
- 단순 점수 높은 순이 아닌, 테마성이 있는 묶음을 만드세요 (배우 계열, 태그 계열, 폴더/시리즈 계열 등).
- 후보 목록 끝에는 순환 다양성을 위한 낮은 점수의 탐색 후보 1개가 포함됩니다. 테마에 어울린다면 이 항목도 적극 활용해 새로운 발견 기회를 만드세요.
- 테마명은 사용자가 폴더명으로 쓰기 좋은 한국어 이름으로 만드세요.
- 각 특집은 최소 5개, 최대 30개 videoId를 포함하세요.
- 같은 videoId가 너무 많은 테마에 중복되지 않게 하세요.
- **배우 다양성**: 특정 배우 한 명을 주제로 하는 테마는 전체 테마 중 최대 1개로 제한하세요. 같은 배우가 여러 테마에 반복 등장하지 않도록 하세요.
- 전체 테마에 걸쳐 가능한 다양한 배우, 태그, 폴더 계열이 골고루 나오도록 하세요.
- 성인물 직접 묘사는 피하고 앱 내부 정리용 테마/태그 수준으로 표현하세요.
- [사용자 요청]이 있으면 그 내용을 최우선으로 반영하세요. 요청에 명시된 배우나 태그가 반드시 포함되어야 합니다.
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

  const userPromptBase = `다음은 내 영상 라이브러리의 상위 ${candidates.length}개 후보입니다. 특집 폴더를 제안해주세요.\n\n${JSON.stringify(candidates)}`
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
  const themes = validateAiThemeFolders(parsed.themeFolders, videos, videoMap)
  if (themes.length === 0) {
    return { success: false, error: 'AI 응답에서 유효한 테마를 찾을 수 없습니다.' }
  }

  // videoMap을 plain object로 변환해 IPC 직렬화 가능하게 반환
  const videoMapObj = {}
  for (const [id, dto] of videoMap) videoMapObj[id] = dto

  return { success: true, themes, candidateCount: candidates.length, videoMap: videoMapObj }
}

module.exports = { generateAiThemeFolders, sanitizeFolderName, validateAiThemeFolders }
