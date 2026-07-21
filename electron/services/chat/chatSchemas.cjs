'use strict'

const TOOL_SCHEMAS = {
  search_videos: {
    description: '조건에 맞는 영상을 검색한다.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        actorNames: { type: 'array', items: { type: 'string' } },
        minRating: { type: 'number', minimum: 0, maximum: 5 },
        actorMinRating: { type: 'number', minimum: 0, maximum: 10 },
        onlyNotCopied: { type: 'boolean' },
        onlyNew: { type: 'boolean' },
        onlyFavorite: { type: 'boolean' },
        sortBy: { type: 'string', enum: ['rating', 'size', 'recent', 'playCount', 'copyCount', 'themeScore'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        baseResultIds: { type: 'array', items: { type: 'integer' }, maxItems: 200 },
        drive: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
  },
  search_actors: {
    description: '이름, 소속사, 별점, 태그 및 메타데이터 상태로 배우를 검색한다.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        agency: { type: 'string' },
        minRating: { type: 'number', minimum: 0, maximum: 10 },
        metadataMissing: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        baseResultIds: { type: 'array', items: { type: 'integer' }, maxItems: 200 },
      },
      additionalProperties: false,
    },
  },
  get_drive_stats: {
    description: '드라이브별 영상 수와 용량 통계를 조회한다.',
    schema: {
      type: 'object',
      properties: {
        drive: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
  },
  get_delete_candidates: {
    description: '용량, 별점, 재생 수, 복사 이력 등을 기준으로 삭제 검토 후보를 조회한다.',
    schema: {
      type: 'object',
      properties: {
        drive: { type: ['string', 'null'] },
        lowRating: { type: 'boolean' },
        lowPlayCount: { type: 'boolean' },
        onlyNotCopied: { type: 'boolean' },
        minSizeBytes: { type: 'number' },
        sortBy: { type: 'string', enum: ['deleteScore', 'size', 'rating', 'playCount'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        baseResultIds: { type: 'array', items: { type: 'integer' }, maxItems: 200 },
      },
      additionalProperties: false,
    },
  },
  get_unmapped_subtitle_summary: {
    description: '자막이 연결되지 않은 영상의 전체 개수와 폴더별 개수를 집계한다.',
    schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['all', 'current_drive', 'current_folder', 'selected_videos'],
        },
        drive: { type: ['string', 'null'] },
        folder: { type: ['string', 'null'], maxLength: 500 },
        baseResultIds: { type: 'array', items: { type: 'integer' }, maxItems: 500 },
      },
      additionalProperties: false,
    },
  },
  search_videos_without_subtitles: {
    description: '자막이 없는 영상 목록을 조회한다.',
    schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['all', 'current_drive', 'current_folder', 'selected_videos'],
        },
        drive: { type: ['string', 'null'], pattern: '^[A-Za-z]:$' },
        folder: { type: ['string', 'null'], maxLength: 500 },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
        baseResultIds: { type: 'array', items: { type: 'integer' }, maxItems: 500 },
      },
      additionalProperties: false,
    },
  },
}

const PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    intent: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    toolName: { type: ['string', 'null'] },
    arguments: { type: 'object' },
    usePreviousResults: { type: 'boolean' },
    needsClarification: { type: 'boolean' },
    requiresConfirmation: { type: 'boolean' },
    clarification: { type: ['object', 'null'] },
    writeIntent: { type: 'boolean' },
  },
  additionalProperties: false,
}

const ERROR_CODES = [
  'VALIDATION_ERROR',
  'AI_CONNECTION_ERROR',
  'AI_RESPONSE_PARSE_ERROR',
  'UNKNOWN_TOOL',
  'TOOL_ARGUMENT_ERROR',
  'TOOL_EXECUTION_ERROR',
  'EMPTY_RESULT',
  'CLARIFICATION_REQUIRED',
  'USER_CONFIRMATION_REQUIRED',
  'REQUEST_CANCELLED',
]

const DEFAULT_CLARIFICATION_OPTIONS = [
  {
    id: 'high_rating',
    label: '별점 높은 작품',
    payload: {
      toolName: 'search_videos',
      arguments: { sortBy: 'rating' },
    },
  },
  {
    id: 'not_copied',
    label: '아직 복사하지 않은 작품',
    payload: {
      toolName: 'search_videos',
      arguments: { onlyNotCopied: true },
    },
  },
  {
    id: 'recent',
    label: '최근 추가한 작품',
    payload: {
      toolName: 'search_videos',
      arguments: { sortBy: 'recent' },
    },
  },
]

module.exports = {
  TOOL_SCHEMAS,
  PLAN_RESPONSE_SCHEMA,
  ERROR_CODES,
  DEFAULT_CLARIFICATION_OPTIONS,
}