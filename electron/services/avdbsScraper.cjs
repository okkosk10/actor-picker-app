'use strict'

const fs = require('fs')
const path = require('path')
const { app, BrowserWindow } = require('electron')

const AVDBS_BASE_URL = 'https://www.avdbs.com'

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripTags(value) {
  return decodeHtml(String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

function htmlToText(html) {
  return stripTags(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' '))
}

async function fetchHtml(url) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  try {
    win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0 Safari/537.36')
    await win.loadURL(url)

    // AVDBS는 일부 페이지에서 렌더 후 JS로 결과를 채우므로, 짧게 대기한 뒤 DOM을 읽는다.
    await new Promise((resolve) => setTimeout(resolve, 4500))

    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML')
    return String(html || '')
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function parseSearchResults(html) {
  const results = []
  const blockRe = /<li\s+data-idx="(\d+)">([\s\S]*?)<\/li>/g
  for (const match of html.matchAll(blockRe)) {
    const [, actorIdx, block] = match
    const imageMatch = block.match(/<img\s+src="([^"]+)"\s+alt="([^"]*)"\s*>/i)
    const kNameMatch = block.match(/<p class="k_name">\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/p>/i)
    const eNameMatch = block.match(/<p class="e_name[^\"]*">\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/p>/i)
    const recommendMatch = block.match(/추천:&nbsp;([\d,]+)&nbsp;회/i)
    const agencyMatch = block.match(/<p class="comment">\s*([\s\S]*?)\s*<\/p>/i)

    const displayName = decodeHtml(stripTags(kNameMatch?.[1] || ''))
    const aliasText = decodeHtml(stripTags(eNameMatch?.[1] || ''))
    const aliasParts = aliasText
      .replace(/^\(|\)$/g, '')
      .split(/[()/]/)
      .map((part) => part.trim())
      .filter(Boolean)

    results.push({
      actorIdx: Number(actorIdx),
      name: displayName,
      aliasText,
      aliases: aliasParts,
      recommendationCount: Number(String(recommendMatch?.[1] || '0').replace(/,/g, '')) || 0,
      agency: decodeHtml(stripTags(agencyMatch?.[1] || '')),
      imageUrl: imageMatch?.[1] || '',
      imageAlt: imageMatch?.[2] || '',
      url: `${AVDBS_BASE_URL}/menu/actor.php?actor_idx=${actorIdx}`,
    })
  }
  return results
}

function parseDetailPage(html, actorIdx, url) {
  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"\s*>/i)?.[1] || ''
  const ogDescription = decodeHtml(html.match(/<meta\s+property="og:description"\s+content="([^"]*)"\s*>/i)?.[1] || '')
  const title = decodeHtml(stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ''))
  const h1 = decodeHtml(stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || ''))
  const bodyText = htmlToText(html)

  const toCanonicalRatingLabel = (label) => {
    const value = String(label || '').trim()
    if (/외모|얼굴/.test(value)) return '외모'
    if (/몸매/.test(value)) return '몸매'
    if (/연기력|연기/.test(value)) return '연기력'
    if (/목소리|보이스/.test(value)) return '목소리'
    if (/섹시|섹시함/.test(value)) return '섹시'
    return value
  }

  const parseRadarRatingsFromHtml = () => {
    const ratings = {}
    const radarScriptMatch = html.match(/\$\(function\(\)\{[\s\S]*?eval_canvas[\s\S]*?window\.myRadar[\s\S]*?\}\);/i)
    if (!radarScriptMatch) return ratings

    const radarScript = radarScriptMatch[0]
    const labelsRaw = radarScript.match(/labels\s*:\s*\[([\s\S]*?)\]\s*,\s*datasets/i)?.[1] || ''
    const dataCandidates = Array.from(radarScript.matchAll(/data\s*:\s*\[([\s\S]*?)\]/gi)).map((m) => m[1] || '')

    const labels = []
    for (const m of labelsRaw.matchAll(/['\"]([^'\"]+)['\"]/g)) {
      labels.push(toCanonicalRatingLabel(m[1]))
    }

    const parseNumericList = (raw) => {
      const nums = []
      for (const m of String(raw || '').matchAll(/['\"]?([0-9]+(?:\.[0-9]+)?)['\"]?/g)) {
        const parsed = Number(m[1])
        if (Number.isFinite(parsed)) nums.push(parsed)
      }
      return nums
    }

    let values = []
    // 실제 배우 레이더 점수는 보통 소수(예: 8.8)로 들어오므로 소수 포함 후보를 우선 선택한다.
    for (const candidate of dataCandidates) {
      const nums = parseNumericList(candidate)
      if (nums.length >= labels.length && nums.some((v) => !Number.isInteger(v))) {
        values = nums
        break
      }
    }

    if (values.length === 0 && dataCandidates.length > 0) {
      const fallback = dataCandidates
        .map((candidate) => parseNumericList(candidate))
        .filter((nums) => nums.length >= labels.length)
        .sort((a, b) => b.length - a.length)[0]
      values = fallback || []
    }

    const count = Math.min(labels.length, values.length)
    for (let i = 0; i < count; i += 1) {
      if (!labels[i]) continue
      ratings[labels[i]] = values[i]
    }
    return ratings
  }

  const ratingAliases = {
    '외모': ['외모', '얼굴'],
    '몸매': ['몸매'],
    '연기력': ['연기력', '연기'],
    '목소리': ['목소리', '보이스'],
    '섹시': ['섹시', '섹시함'],
  }
  const parseAnnotatedRatings = () => {
    const ratings = {}
    const source = `${html}\n${bodyText}`
    for (const [canonicalLabel, aliases] of Object.entries(ratingAliases)) {
      for (const alias of aliases) {
        const re = new RegExp(`${alias}[\\s\\S]{0,24}\\(([0-9]+(?:\\.[0-9]+)?)\\)`, 'i')
        const match = source.match(re)
        if (!match) continue
        const parsed = Number(match[1])
        if (Number.isFinite(parsed)) {
          ratings[canonicalLabel] = parsed
          break
        }
      }
    }
    return ratings
  }

  const ratings = {
    ...parseRadarRatingsFromHtml(),
    ...parseAnnotatedRatings(),
  }
  for (const [canonicalLabel, aliases] of Object.entries(ratingAliases)) {
    const patterns = [
      ...aliases.map((label) => new RegExp(`${label}\\s*[:：]\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i')),
      ...aliases.map((label) => new RegExp(`${label}\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i')),
    ]
    let value = null
    for (const pattern of patterns) {
      const match = bodyText.match(pattern)
      if (match) {
        value = Number(match[1])
        if (Number.isFinite(value)) break
      }
    }
    if (Number.isFinite(value)) ratings[canonicalLabel] = value
  }

  if (Object.keys(ratings).length === 0) {
    const lines = bodyText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    for (const line of lines) {
      for (const [canonicalLabel, aliases] of Object.entries(ratingAliases)) {
        if (ratings[canonicalLabel] != null) continue
        if (!aliases.some((alias) => line.includes(alias))) continue

        const numMatch = line.match(/(10|[0-9](?:\.[0-9]+)?)/)
        if (numMatch) {
          const parsed = Number(numMatch[1])
          if (Number.isFinite(parsed)) ratings[canonicalLabel] = parsed
        }
      }
    }
  }

  let averageRating = null
  const avgFromHtml = html.match(/배우평점[\s\S]{0,32}?([0-9]+(?:\.[0-9]+)?)/i)
  if (avgFromHtml) {
    const parsed = Number(avgFromHtml[1])
    if (Number.isFinite(parsed)) averageRating = parsed
  }

  const avgLine = bodyText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.includes('배우평점'))

  if (averageRating == null && avgLine) {
    const avgMatch = avgLine.match(/([0-9]+(?:\.[0-9]+)?)/)
    if (avgMatch) {
      const parsed = Number(avgMatch[1])
      if (Number.isFinite(parsed)) averageRating = parsed
    }
  }

  if (averageRating == null && Object.keys(ratings).length > 0) {
    averageRating = Number((Object.values(ratings).reduce((sum, value) => sum + value, 0) / Object.keys(ratings).length).toFixed(1))
  }

  const getLine = (label) => {
    const re = new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i')
    return decodeHtml((bodyText.match(re)?.[1] || '').trim())
  }

  const birth = getLine('생년월일')
  const height = getLine('신장')
  const measurements = getLine('신체사이즈')
  const cup = getLine('컵사이즈')
  const debut = getLine('데뷔')

  const nameParts = h1.split('/').map((part) => part.trim()).filter(Boolean)
  const primaryName = nameParts[0] || title.split('|')[0].trim()
  const aliases = nameParts.slice(1)

  return {
    actorIdx: Number(actorIdx),
    url,
    title,
    primaryName,
    aliases,
    imageUrl: ogImage,
    ogDescription,
    rawText: bodyText,
    avdbsRatings: ratings,
    avdbsAverageRating: averageRating,
    profile: {
      birth,
      height,
      measurements,
      cup,
      debut,
      agency: getLine('소속사무소'),
      intro: bodyText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .find((line) => line && !line.includes('생년월일') && !line.includes('신장') && !line.includes('신체사이즈') && !line.includes('컵사이즈') && !line.includes('데뷔') && !line.includes('소속사무소') && !line.includes('배우평점')) || '',
    },
  }
}

function buildSuggestedTags(detail, searchResult = null) {
  const tags = []
  const joined = [
    detail.rawText || '',
    detail.profile?.intro || '',
    detail.ogDescription || '',
    searchResult?.aliasText || '',
    detail.title || '',
  ].join(' ')

  const heightText = detail.profile?.height || ''
  const heightMatch = heightText.match(/(\d{3})\s*cm/i)
  const height = heightMatch ? Number(heightMatch[1]) : null
  if (height != null) {
    if (height <= 154) tags.push('단신')
    if (height >= 168) tags.push('장신')
  }

  if (/FC2/i.test(joined)) tags.push('FC2')

  if (/질내사\s*(?:정|[oO0ㅇ○◯●◎Ｏ])/.test(joined)) tags.push('질사해금')

  return Array.from(new Set(tags))
}

function getImageExtension(url, contentType = '') {
  const clean = String(url || '').split('?')[0]
  const ext = path.extname(clean).toLowerCase().replace('.', '')
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return ext === 'jpg' ? 'jpg' : ext
  if (/jpeg/i.test(contentType)) return 'jpg'
  if (/png/i.test(contentType)) return 'png'
  if (/webp/i.test(contentType)) return 'webp'
  return 'jpg'
}

async function downloadImageToUserData(imageUrl, actorId, actorName, externalId) {
  if (!imageUrl) return null
  const resp = await fetch(imageUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0 Safari/537.36',
      'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
    },
  })
  if (!resp.ok) {
    throw new Error(`이미지 다운로드 실패: ${resp.status} ${resp.statusText}`)
  }

  const buffer = Buffer.from(await resp.arrayBuffer())
  const ext = getImageExtension(imageUrl, resp.headers.get('content-type') || '')
  const safeActorId = Number.isFinite(Number(actorId)) && Number(actorId) > 0 ? Number(actorId) : 0
  const stamp = Date.now()
  const safeExternal = String(externalId || 'avdbs').replace(/[^0-9a-zA-Z_-]/g, '_')
  const safeName = String(actorName || 'actor').replace(/[^0-9a-zA-Z_-]/g, '_').slice(0, 24)
  const fileName = `actor_${safeActorId}_${safeExternal}_${safeName}_${stamp}.${ext}`
  const actorsDir = path.join(app.getPath('userData'), 'actors')
  fs.mkdirSync(actorsDir, { recursive: true })
  fs.writeFileSync(path.join(actorsDir, fileName), buffer)
  return fileName
}

async function searchAvdbsActors(query) {
  const kwd = String(query || '').trim()
  if (!kwd) return []
  const url = `${AVDBS_BASE_URL}/menu/search.php?kwd=${encodeURIComponent(kwd)}&seq=${Date.now()}&tab=1`
  const html = await fetchHtml(url)
  return parseSearchResults(html)
}

async function fetchAvdbsActorDetail(actorIdx) {
  const idx = Number(actorIdx)
  if (!Number.isFinite(idx) || idx <= 0) {
    throw new Error(`유효하지 않은 AVDBS actorIdx: ${actorIdx}`)
  }
  const url = `${AVDBS_BASE_URL}/menu/actor.php?actor_idx=${idx}`
  const html = await fetchHtml(url)
  return parseDetailPage(html, idx, url)
}

module.exports = {
  searchAvdbsActors,
  fetchAvdbsActorDetail,
  downloadImageToUserData,
  buildSuggestedTags,
}