'use strict'

/**
 * electron/services/themeCandidateService.cjs
 * DB 영상 데이터를 기반으로 로컬 후보 점수를 계산한다.
 *
 * 점수 구성:
 *   watchScore  = 재생/선호 기반 점수
 *   copyScore   = 복사/소장 기반 점수
 *   themeScore  = watchScore + copyScore + 메타데이터 보너스 - 페널티
 */

const PERMANENT_GRADES = new Set(['permanent', 'rewatch', '영구소장', '재시청', '재시청 추천'])
const DELETE_GRADES    = new Set(['delete_candidate', '삭제요망', '삭제 요망'])

/**
 * 개별 영상의 세 가지 점수를 계산한다.
 * @param {object} v - 영상 DTO
 * @returns {{ watchScore: number, copyScore: number, themeScore: number }}
 */
function calcScores(v) {
  const rating               = Number(v.rating)               || 0
  const playCount            = Number(v.playCount)            || 0
  const copyCount            = Number(v.copyCount)            || 0
  const downloadRequestCount = Number(v.downloadRequestCount) || 0
  const actorCopyCount       = Number(v.actorCopyCount)       || 0
  const tagCopyCount         = Number(v.tagCopyCount)         || 0
  const favorite             = Boolean(v.favorite)
  const recommended          = Boolean(v.recommended)
  const grade                = v.grade ?? ''
  const tags                 = Array.isArray(v.tags) ? v.tags : []
  const actors               = v.actors ?? v.primaryActor ?? ''
  const folderName           = v.folderName ?? ''

  // watchScore
  let watchScore = rating * 20
  if (favorite)   watchScore += 20
  if (recommended) watchScore += 15
  watchScore += playCount            * 3
  watchScore += downloadRequestCount * 8

  // copyScore
  let copyScore = rating * 15
  if (favorite)   copyScore += 25
  if (recommended) copyScore += 20
  copyScore += copyCount * 15
  if (PERMANENT_GRADES.has(grade)) copyScore += 20

  // themeScore
  let themeScore = watchScore + copyScore
  if (tags.length >= 2)         themeScore += 10
  if (actors && actors !== '')  themeScore += 10
  if (folderName && folderName !== '') themeScore += 5
  if (DELETE_GRADES.has(grade)) themeScore -= 50
  // 배우/태그 누적 복사 횟수 가중치 — 자주 복사된 배우·태그 계열 우선 추천
  themeScore += Math.min(actorCopyCount, 50) * 2   // 배우 총 복사 횟수 (최대 +100)
  themeScore += Math.min(tagCopyCount,   30) * 1   // 태그 총 복사 횟수 (최대 +30)

  return { watchScore, copyScore, themeScore }
}

/**
 * 전체 영상에서 themeScore 상위 limit개의 후보를 빌드한다.
 *
 * @param {object[]} videos      - DB에서 조회한 전체 영상 DTO 배열
 * @param {number}   limit       - 반환할 최대 후보 수 (기본 120)
 * @param {Set<number>} priorityIds - 점수와 무관하게 반드시 포함할 video id 집합
 * @returns {object[]} - AI에게 전달할 후보 DTO 배열
 */
function buildThemeCandidates(videos, limit = 120, priorityIds = new Set()) {
  if (!Array.isArray(videos) || videos.length === 0) return []

  const scored = videos.map(v => {
    const { watchScore, copyScore, themeScore } = calcScores(v)
    const fileSizeGB = v.fileSize ? Number((v.fileSize / 1073741824).toFixed(2)) : 0

    return {
      // AI에게 전달할 식별자 및 콘텐츠 정보
      id:                   v.id,
      fileName:             v.fileName    ?? v.file_name    ?? '',
      folderName:           v.folderName  ?? v.folder_name  ?? '',
      actors:               v.actors      ?? v.actor_name   ?? '',
      primaryActor:         v.primaryActor ?? '',
      tags:                 Array.isArray(v.tags) ? v.tags : [],
      rating:               Number(v.rating)    || 0,
      grade:                v.grade             ?? '',
      playCount:            Number(v.playCount  ?? v.play_count)  || 0,
      downloadRequestCount: Number(v.downloadRequestCount ?? v.download_request_count) || 0,
      copyCount:            Number(v.copyCount  ?? v.copy_count)  || 0,
      actorCopyCount:       Number(v.actorCopyCount) || 0,
      tagCopyCount:         Number(v.tagCopyCount)   || 0,
      favorite:             Boolean(v.favorite),
      recommended:          Boolean(v.recommended),
      fileSizeGB,
      watchScore,
      copyScore,
      themeScore,
    }
  })

  // themeScore 내림차순 정렬
  scored.sort((a, b) => b.themeScore - a.themeScore)

  // ── 우선 포함 항목 분리 (customPrompt에서 언급된 배우/태그 등)
  // priorityIds에 해당하는 영상은 perActorLimit·점수 무관하게 먼저 포함
  const priorityItems   = scored.filter(v => priorityIds.has(v.id))
  const nonPriorityItems = scored.filter(v => !priorityIds.has(v.id))

  // 배우별 상한선 적용: 동일 배우가 후보의 25% 이상을 차지하지 않도록 제한
  // 단, 배우명이 없는 영상은 제한 없이 포함
  const mainLimit  = Math.max(1, limit - 1)   // 탐색 후보 1개를 위해 1 자리 확보
  const nonPrioritySlots = Math.max(0, mainLimit - priorityItems.length)
  const perActorLimit = Math.max(5, Math.ceil(nonPrioritySlots * 0.25))
  const actorCount    = {}
  const limited       = [...priorityItems]
  for (const v of nonPriorityItems) {
    if (limited.length >= mainLimit) break
    const actor = (v.primaryActor || v.actors || '').trim()
    if (!actor) {
      limited.push(v)
    } else {
      const cnt = actorCount[actor] || 0
      if (cnt < perActorLimit) {
        limited.push(v)
        actorCount[actor] = cnt + 1
      }
    }
  }

  // 탐색 후보 1개: 메인 풀에 포함되지 않은 구간에서 랜덤 선택 (순환 다양성)
  // 항상 같은 고점수 영상만 테마에 올라오는 쏠림을 방지
  const limitedIds   = new Set(limited.map(v => v.id))
  const discoverPool = scored
    .filter(v => !limitedIds.has(v.id) && !DELETE_GRADES.has(v.grade ?? ''))
    .slice(0, limit * 2)
  if (discoverPool.length > 0) {
    const idx = Math.floor(Math.random() * Math.min(discoverPool.length, limit))
    limited.push(discoverPool[idx])
  }

  return limited
}

module.exports = { buildThemeCandidates, calcScores }
