'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { createJellyfinApiService } = require('../jellyfinApiService.cjs')

function createJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-type' ? 'application/json' : ''
      },
    },
    async json() {
      return payload
    },
    async text() {
      return JSON.stringify(payload)
    },
  }
}

function buildFetchWithRoutes(routes, calls) {
  return async (url, options = {}) => {
    calls.push({ url, options })
    const key = `${String(options.method || 'GET').toUpperCase()} ${new URL(url).pathname}`
    const handler = routes[key]
    if (!handler) throw new Error(`Unexpected route: ${key}`)
    return handler(url, options)
  }
}

test('/Users 엔드포인트를 호출하고 isDisabled=false 쿼리를 사용한다', async () => {
  const calls = []
  const fetchImpl = buildFetchWithRoutes({
    'GET /Users': async () => createJsonResponse(200, [{ Id: '5f4f2c2d-9f58-4adb-9e80-f5f69a0b11f0', Name: 'admin' }]),
  }, calls)

  const api = createJellyfinApiService({
    serverUrl: 'http://localhost:8096',
    apiKey: 'test-key',
    fetchImpl,
  })

  const userId = await api.resolveUserId()
  assert.equal(userId, '5f4f2c2d-9f58-4adb-9e80-f5f69a0b11f0')

  const firstCall = calls.find((entry) => new URL(entry.url).pathname === '/Users')
  assert.ok(firstCall)
  assert.equal(new URL(firstCall.url).searchParams.get('isDisabled'), 'false')
})

test('배열 응답에서 첫 사용자 UUID를 탐색한다', async () => {
  const fetchImpl = buildFetchWithRoutes({
    'GET /Users': async () => createJsonResponse(200, [
      { Id: 'not-a-uuid', Name: 'name-only' },
      { Id: '2f4b4e5f-1111-4444-8888-1234567890ab', Name: 'user2' },
    ]),
  }, [])

  const api = createJellyfinApiService({
    serverUrl: 'http://localhost:8096',
    apiKey: 'test-key',
    fetchImpl,
  })

  assert.equal(await api.resolveUserId(), '2f4b4e5f-1111-4444-8888-1234567890ab')
})

test('활성 사용자 배열이 비어 있으면 명확한 오류를 던진다', async () => {
  const fetchImpl = buildFetchWithRoutes({
    'GET /Users': async () => createJsonResponse(200, []),
  }, [])

  const api = createJellyfinApiService({
    serverUrl: 'http://localhost:8096',
    apiKey: 'test-key',
    fetchImpl,
  })

  await assert.rejects(() => api.resolveUserId(), /활성 Jellyfin 사용자를 찾을 수 없습니다/)
})

test('설정된 UUID가 있으면 /Users 자동 탐색 호출을 생략한다', async () => {
  const calls = []
  const fetchImpl = buildFetchWithRoutes({
    'GET /Users/6e810634-3e96-4ce1-8e98-f3cf0b9702d8': async () => createJsonResponse(200, {
      Id: '6e810634-3e96-4ce1-8e98-f3cf0b9702d8',
      Name: 'owner',
    }),
  }, calls)

  const api = createJellyfinApiService({
    serverUrl: 'http://localhost:8096',
    apiKey: 'test-key',
    userId: '6e810634-3e96-4ce1-8e98-f3cf0b9702d8',
    fetchImpl,
  })

  assert.equal(await api.resolveUserId(), '6e810634-3e96-4ce1-8e98-f3cf0b9702d8')
  assert.equal(calls.some((entry) => new URL(entry.url).pathname === '/Users'), false)
})

test('사용자 이름 문자열을 UUID로 오인하지 않는다', async () => {
  const api = createJellyfinApiService({
    serverUrl: 'http://localhost:8096',
    apiKey: 'test-key',
    userId: 'admin',
    fetchImpl: async () => {
      throw new Error('should not call')
    },
  })

  await assert.rejects(() => api.resolveUserId(), /UUID 형식/)
})

test('연결 테스트 결과는 serverName/version/userId/userName을 반환한다', async () => {
  const calls = []
  const fetchImpl = buildFetchWithRoutes({
    'GET /System/Info/Public': async () => createJsonResponse(200, {
      ServerName: 'JF',
      Version: '10.10.0',
    }),
    'GET /Users': async () => createJsonResponse(200, [
      { Id: 'e5d8fb55-c6f0-4b01-bf8d-2e34b4b6e7f8', Name: 'jelly-admin' },
    ]),
  }, calls)

  const api = createJellyfinApiService({
    serverUrl: 'http://localhost:8096',
    apiKey: 'test-key',
    fetchImpl,
  })

  const result = await api.testConnection()
  assert.equal(result.serverName, 'JF')
  assert.equal(result.version, '10.10.0')
  assert.equal(result.userId, 'e5d8fb55-c6f0-4b01-bf8d-2e34b4b6e7f8')
  assert.equal(result.userName, 'jelly-admin')

  const listCall = calls.find((entry) => new URL(entry.url).pathname === '/Users')
  assert.ok(listCall)
  assert.equal(new URL(listCall.url).searchParams.get('isDisabled'), 'false')
})

test('API 오류 메시지에 endpoint와 Jellyfin 메시지를 포함한다', async () => {
  const fetchImpl = buildFetchWithRoutes({
    'GET /Users': async () => createJsonResponse(400, { Message: 'Bad request from Jellyfin' }),
  }, [])

  const api = createJellyfinApiService({
    serverUrl: 'http://localhost:8096',
    apiKey: 'test-key',
    fetchImpl,
  })

  await assert.rejects(
    () => api.resolveUserId(),
    /GET \/Users: Bad request from Jellyfin/,
  )
})
