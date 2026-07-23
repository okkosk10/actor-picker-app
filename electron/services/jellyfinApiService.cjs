'use strict'

const DEFAULT_TIMEOUT_MS = 12000
const MAX_RETRY_COUNT = 2
const UUID_V4_OR_V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
      if (!isValidUuid(cachedUserId)) {
        throw new Error('Jellyfin User ID는 UUID 형식이어야 합니다.')
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
      query: { isDisabled: false },
      signal,
    })

    const users = Array.isArray(result) ? result : []
    const first = users.find((user) => isValidUuid(user?.Id)) || null
    if (!first) {
      throw new Error('활성 Jellyfin 사용자를 찾을 수 없습니다. User ID(UUID)를 직접 입력해 주세요.')
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
    const query = {
      IncludeItemTypes: 'Person',
      Recursive: true,
      SearchTerm: String(name || '').trim(),
      Limit: Number.isFinite(options.limit) ? options.limit : 50,
      Fields: 'PrimaryImageAspectRatio,Overview',
    }
    const result = await request(`/Users/${encodeURIComponent(userId)}/Items`, {
      method: 'GET',
      query,
      signal: options.signal,
    })

    return Array.isArray(result?.Items) ? result.Items : []
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
    await request(`/Items/${encodeURIComponent(personId)}/Images/Primary`, {
      method: 'POST',
      headers: {
        'Content-Type': image.contentType,
      },
      body: image.buffer,
      signal: options.signal,
      expect: 'empty',
    })
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
}
