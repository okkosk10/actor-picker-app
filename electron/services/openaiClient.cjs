'use strict'

/**
 * electron/services/openaiClient.cjs
 * OpenAI API 클라이언트 초기화 및 유틸리티
 *
 * 보안 원칙:
 *   - API Key는 .env에서만 읽는다 (하드코딩 절대 금지)
 *   - API Key를 로그에 출력하지 않는다
 *   - Renderer(React)에 API Key를 노출하지 않는다
 *   - 모든 OpenAI 호출은 이 파일 또는 main process에서만 수행한다
 */

const path = require('path')

// 프로젝트 루트의 .env 파일을 명시적으로 로드한다.
// electron-builder 패키지 후에도 루트 위치를 정확히 찾기 위해 __dirname 기준으로 경로를 지정한다.
require('dotenv').config({ path: path.join(__dirname, '../../.env') })

const { default: OpenAI } = require('openai')

/** 싱글톤 OpenAI 클라이언트 */
let _client = null

/**
 * OpenAI 클라이언트 인스턴스를 반환한다.
 * API Key가 설정되지 않으면 에러를 던진다.
 * @returns {OpenAI}
 */
function getOpenAIClient() {
  if (_client) return _client

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_openai_api_key_here') {
    throw new Error('OPENAI_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.')
  }

  _client = new OpenAI({ apiKey })
  return _client
}

/**
 * OpenAI 연결을 테스트한다.
 * Responses API로 간단한 요청을 보내 응답을 확인한다.
 * @returns {Promise<{ success: true, model: string, message: string }>}
 */
async function testOpenAIConnection() {
  const client = getOpenAIClient()
  const model  = process.env.OPENAI_MODEL || 'gpt-4.1'

  const response = await client.responses.create({
    model,
    input: 'Reply with exactly one word: OK',
  })

  const text = response.output_text?.trim() ?? ''
  return { success: true, model, message: text }
}

module.exports = { getOpenAIClient, testOpenAIConnection }
