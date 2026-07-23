'use strict'

const DEFAULT_TIMEOUT_MS = 12000
const MAX_RETRY_COUNT = 2
const UUID_V4_OR_V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEX32_RE = /^[0-9a-f]{32}$/i

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sanitizeBaseUrl(url) {
  const normalized = String(url || '').trim().replace(/\/+$/, '')
  return normalized
}

function isValidUuid(value) {
  return UUID_V4_OR_V5_RE.test(String(value || '').trim())
}

function isValidJellyfinUserId(value) {
  const text = String(value || '').trim()
  return Boolean(text) && (isValidUuid(text) || HEX32_RE.test(text))
}

function isRetryableStatus(status) {
  return Number(status) >= 500
}

function isRetryableError(error) {
  if (!error) return false
  if (error.name === 'AbortError') return true
  const message = String(error.message || '').toLowerCase()
  return message.includes('network') || message.includes('fetch') || message.includes('timeout') || message.includes('socket')
}

function buildAuthHeaders(apiKey) {
  return {
    'X-Emby-Token': apiKey,
    Accept: 'application/json',
  }
}

function appendQuery(url, query = {}) {
  const next = new URL(url)
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    next.searchParams.set(key, String(value))
  })
  return next.toString()
}

function mergeAbortSignals(parentSignal, timeoutMs) {
  const controller = new AbortController()
  let timeoutId = null

  const onAbort = () => controller.abort(parentSignal?.reason || new Error('aborted'))
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort(parentSignal.reason || new Error('aborted'))
    else parentSignal.addEventListener('abort', onAbort, { once: true })
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (parentSignal) parentSignal.removeEventListener('abort', onAbort)
      if (timeoutId) clearTimeout(timeoutId)
    },
  }
}

async function parseResponseBody(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('application/json')) {
    return response.json()
  }
  return response.text()
}

function extractJellyfinErrorMessage(payload) {
  if (typeof payload === 'string') return payload.trim().slice(0, 500)
  if (!payload || typeof payload !== 'object') return ''

  const candidates = [
    payload.Message,
    payload.ErrorMessage,
    payload.message,
    payload.error,
    payload.details,
  ]

  for (const candidate of candidates) {
    const text = String(candidate || '').trim()
    if (text) return text.slice(0, 500)
  }

  return ''
}

function toItemsArray(result) {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.Items)) return result.Items
  return []
}

function createJellyfinApiService(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('현재 런타임에서 fetch를 사용할 수 없습니다.')
  }

  const serverUrl = sanitizeBaseUrl(options.serverUrl)
  const apiKey = String(options.apiKey || '').trim()
  const configuredUserId = String(options.userId || '').trim()
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS

  if (!serverUrl) throw new Error('Jellyfin 서버 URL이 설정되지 않았습니다.')
  if (!apiKey) throw new Error('Jellyfin API Key가 설정되지 않았습니다.')

  let cachedUserId = configuredUserId || ''
  let cachedUserName = ''

  async function request(pathname, requestOptions = {}) {
    const method = requestOptions.method || 'GET'
    const query = requestOptions.query || null
    const body = requestOptions.body
    const headers = {
      ...buildAuthHeaders(apiKey),
      ...(requestOptions.headers || {}),
    }

    const url = appendQuery(`${serverUrl}${pathname}`, query || undefined)

    let attempt = 0
    while (true) {
      const mergedSignal = mergeAbortSignals(requestOptions.signal, timeoutMs)
      try {
        const response = await fetchImpl(url, {
          method,
          headers,
          body,
          signal: mergedSignal.signal,
        })

        if (!response.ok) {
          const payload = await parseResponseBody(response)
          const jellyfinMessage = extractJellyfinErrorMessage(payload)
          const endpoint = `${method.toUpperCase()} ${pathname}`
          const err = new Error(
            jellyfinMessage
              ? `Jellyfin API 오류 (${response.status}) ${endpoint}: ${jellyfinMessage}`
              : `Jellyfin API 오류 (${response.status}) ${endpoint}`,
          )
          err.status = response.status
          err.path = pathname
          err.endpoint = endpoint
          err.jellyfinMessage = jellyfinMessage
          err.payload = payload
          throw err
        }

        if (requestOptions.expect === 'raw') return response
        if (requestOptions.expect === 'empty') return null
        return parseResponseBody(response)
      } catch (error) {
        const shouldRetry = attempt < MAX_RETRY_COUNT && (isRetryableStatus(error?.status) || isRetryableError(error))
        if (!shouldRetry) throw error
        const waitMs = 250 * Math.pow(2, attempt)
        await delay(waitMs)
        attempt += 1
      } finally {
        mergedSignal.cleanup()
      }
    }
  }

  async function getUserById(userId, signal) {
    return request(`/Users/${encodeURIComponent(userId)}`, {
      method: 'GET',
      signal,
    })
  }

  async function resolveUserIdentity(signal) {
    if (cachedUserId) {
      if (!isValidJellyfinUserId(cachedUserId)) {
        throw new Error('Jellyfin User ID 형식이 올바르지 않습니다. (UUID 또는 32자리 hex)')
      }

      if (!cachedUserName) {
        try {
          const user = await getUserById(cachedUserId, signal)
          cachedUserName = String(user?.Name || '').trim()
        } catch {
          cachedUserName = ''
        }
      }

      return { userId: cachedUserId, userName: cachedUserName }
    }

    const result = await request('/Users', {
      method: 'GET',
      query: { isDisabled: false, IsDisabled: false },
      signal,
    })

    const users = Array.isArray(result)
      ? result
      : Array.isArray(result?.Items)
        ? result.Items
        : []
    const first = users.find((user) => isValidJellyfinUserId(user?.Id)) || null
    if (!first) {
      throw new Error('활성 Jellyfin 사용자를 찾을 수 없습니다. User ID를 직접 입력해 주세요.')
    }

    cachedUserId = String(first.Id)
    cachedUserName = String(first.Name || '').trim()
    return { userId: cachedUserId, userName: cachedUserName }
  }

  async function resolveUserId(signal) {
    const identity = await resolveUserIdentity(signal)
    return identity.userId
  }

  async function testConnection(signal) {
    const info = await request('/System/Info/Public', { signal })
    const identity = await resolveUserIdentity(signal)
    return {
      success: true,
      serverName: info?.ServerName || '',
      version: info?.Version || '',
      userId: identity.userId,
      userName: identity.userName || '',
    }
  }

  async function searchPersonsByName(name, options = {}) {
    const userId = await resolveUserId(options.signal)
    const term = String(name || '').trim()
    const query = {
      IncludeItemTypes: 'Person',
      Recursive: true,
      SearchTerm: term,
      Limit: Number.isFinite(options.limit) ? options.limit : 50,
      Fields: 'PrimaryImageAspectRatio,Overview',
    }
    const merged = new Map()

    // 1) Person 전용 엔드포인트 우선 시도 (서버별로 지원 차이가 있어 실패해도 fallback)
    try {
      const personResult = await request('/Persons', {
        method: 'GET',
        query: {
          SearchTerm: term,
          NameContains: term,
          Recursive: true,
          Limit: Number.isFinite(options.limit) ? options.limit : 50,
          Fields: 'PrimaryImageAspectRatio,Overview',
        },
        signal: options.signal,
      })
      for (const item of toItemsArray(personResult)) {
        if (item?.Id) merged.set(String(item.Id), item)
      }
    } catch (error) {
      if (Number(error?.status) !== 404 && Number(error?.status) !== 400) {
        throw error
      }
    }

    // 2) 사용자 아이템 엔드포인트 fallback/보강
    const result = await request(`/Users/${encodeURIComponent(userId)}/Items`, {
      method: 'GET',
      query,
      signal: options.signal,
    })
    for (const item of toItemsArray(result)) {
      if (item?.Id) merged.set(String(item.Id), item)
    }

    return Array.from(merged.values())
  }

  async function getPersonById(personId, options = {}) {
    const userId = await resolveUserId(options.signal)
    return request(`/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(personId)}`, {
      method: 'GET',
      query: {
        Fields: 'ProviderIds,Overview,ProductionLocations,Tags,Studios,Genres,People',
      },
      signal: options.signal,
    })
  }

  async function updatePersonMetadata(personId, payload, options = {}) {
    await request(`/Items/${encodeURIComponent(personId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
      signal: options.signal,
      expect: 'empty',
    })
    return { success: true }
  }

  async function uploadPrimaryImage(personId, image, options = {}) {
    const encodedId = encodeURIComponent(personId)
    const baseHeaders = {
      'Content-Type': image.contentType,
      'Content-Length': String(image?.buffer?.length || 0),
    }
    const noLengthHeaders = {
      'Content-Type': image.contentType,
    }
    const attempts = []

    const shouldFallback = (error) => {
      if (!error) return false
      if (error.name === 'AbortError') return false
      const message = String(error.message || '').toLowerCase()
      if (message.includes('aborted') || message.includes('취소')) return false
      return true
    }

    try {
      attempts.push(`/Items/${encodedId}/Images/Primary`)
      await request(`/Items/${encodedId}/Images/Primary`, {
        method: 'POST',
        headers: baseHeaders,
        body: image.buffer,
        signal: options.signal,
        expect: 'empty',
      })
    } catch (primaryError) {
      if (!shouldFallback(primaryError)) throw primaryError

      try {
        attempts.push(`/Items/${encodedId}/Images?Type=Primary&ImageType=Primary`)
        await request(`/Items/${encodedId}/Images`, {
          method: 'POST',
          headers: baseHeaders,
          query: { Type: 'Primary', ImageType: 'Primary' },
          body: image.buffer,
          signal: options.signal,
          expect: 'empty',
        })
      } catch (fallbackError) {
        if (!shouldFallback(fallbackError)) throw fallbackError

        try {
          // Some servers reject explicit Content-Length for streamed bodies; retry without it.
          attempts.push(`/Items/${encodedId}/Images?Type=Primary`)
          await request(`/Items/${encodedId}/Images`, {
            method: 'POST',
            headers: noLengthHeaders,
            query: { Type: 'Primary' },
            body: image.buffer,
            signal: options.signal,
            expect: 'empty',
          })
        } catch (lastError) {
          const chain = [primaryError, fallbackError, lastError]
            .map((err) => String(err?.message || ''))
            .filter(Boolean)
            .join(' | ')
          throw new Error(`${primaryError.message} (재시도 경로: ${attempts.join(' -> ')}) (fallback 실패: ${chain})`)
        }
      }
    }

    return { success: true }
  }

  return {
    testConnection,
    resolveUserId,
    searchPersonsByName,
    getPersonById,
    updatePersonMetadata,
    uploadPrimaryImage,
  }
}

module.exports = {
  createJellyfinApiService,
  sanitizeBaseUrl,
  isValidUuid,
  isValidJellyfinUserId,
}
