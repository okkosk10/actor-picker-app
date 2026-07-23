'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  parseSubtitleContent,
} = require('../subtitleParserService.cjs')
const {
  chunkSubtitleCues,
} = require('../subtitleChunkService.cjs')
const {
  parseMaybeJson,
  normalizeFinalAnalysis,
  normalizeChunkAnalysis,
  cleanTags,
  SUBTITLE_METADATA_PROMPT_VERSION,
} = require('../subtitleAiAnalysisService.cjs')

test('SRT 번호와 타임코드를 파싱한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/SONE-001.srt',
    content: '1\n00:01:12,000 --> 00:01:14,000\n안녕하세요.',
  })

  assert.equal(result.stats.originalCueCount, 1)
  assert.equal(result.cues[0].startTime, '00:01:12')
  assert.equal(result.cues[0].text, '안녕하세요.')
})

test('SRT 멀티라인 대사를 유지한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/SONE-002.srt',
    content: '1\n00:00:01,000 --> 00:00:03,000\n안녕\n하세요.',
  })

  assert.equal(result.cues[0].text, '안녕\n하세요.')
})

test('ASS Dialogue와 스타일 태그를 정리한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/SONE-003.ass',
    content: '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\an8}{\\i1}안녕\\N하세요',
  })

  assert.equal(result.cues[0].startTime, '00:00:01')
  assert.equal(result.cues[0].text, '안녕\n하세요')
})

test('VTT 헤더와 cue identifier를 제거한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/SONE-004.vtt',
    content: 'WEBVTT\n\nintro\n00:00:01.000 --> 00:00:02.500\nHello world',
  })

  assert.equal(result.cues[0].text, 'Hello world')
})

test('BOM과 HTML 태그를 제거한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/SONE-005.srt',
    content: '\uFEFF1\n00:00:01,000 --> 00:00:02,000\n<b>안녕</b>',
  })

  assert.equal(result.cues[0].text, '안녕')
})

test('연속 중복 대사를 제거한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/SONE-006.srt',
    content: '1\n00:00:01,000 --> 00:00:02,000\n안녕\n\n2\n00:00:02,100 --> 00:00:03,000\n안녕',
  })

  assert.equal(result.cues.length, 1)
  assert.equal(result.stats.removedDuplicateLines, 1)
})

test('반복 감탄사는 축약된다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/SONE-007.srt',
    content: '1\n00:00:01,000 --> 00:00:02,000\n아...\n\n2\n00:00:02,100 --> 00:00:03,000\n아...\n\n3\n00:00:03,100 --> 00:00:04,000\n아...\n\n4\n00:00:04,100 --> 00:00:05,000\n아...',
  })

  assert.equal(result.cues[0].text, '[반복 감탄사 4회]')
  assert.equal(result.stats.collapsedRepetitionCount, 4)
})

test('명확한 광고 URL은 제거한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/SONE-008.srt',
    content: '1\n00:00:01,000 --> 00:00:02,000\nhttps://example.com\n\n2\n00:00:02,100 --> 00:00:03,000\n대사는 남긴다',
  })

  assert.equal(result.cues.length, 1)
  assert.equal(result.cues[0].text, '대사는 남긴다')
  assert.equal(result.stats.removedAdLines, 1)
})

test('구간 분할은 cue 중간에서 자르지 않는다', () => {
  const cues = [
    { startTime: '00:00:01', endTime: '00:00:02', text: '가'.repeat(30) },
    { startTime: '00:00:03', endTime: '00:00:04', text: '나'.repeat(30) },
    { startTime: '00:00:05', endTime: '00:00:06', text: '다'.repeat(30) },
  ]
  const result = chunkSubtitleCues(cues, { maxChars: 70, minTailChars: 10 })

  assert.equal(result.chunkCount >= 2, true)
  assert.equal(result.chunks[0].text.includes('가'.repeat(30)), true)
  assert.equal(result.chunks[0].text.includes('나'.repeat(30)), false)
})

test('최종 AI JSON은 기본값 보정과 태그 정리를 수행한다', () => {
  const parsed = parseMaybeJson('```json\n{"outline":"설명","plot":"줄거리","story_structure":{"opening":"a"},"tags":["배우A","https://bad","상황"],"relationship":["직장 동료"],"tone":["차분함"],"confidence":1.5,"warnings":["주의"]}\n```')
  const normalized = normalizeFinalAnalysis(parsed)
  const tags = cleanTags(normalized.tags, { actorNames: ['배우A'], code: 'SONE-001' })

  assert.equal(normalized.outline, '설명')
  assert.equal(normalized.story_structure.opening, 'a')
  assert.equal(normalized.confidence, 1)
  assert.deepEqual(tags, ['상황'])
})

test('chunk 분석 기본값은 누락 필드를 채운다', () => {
  const normalized = normalizeChunkAnalysis({ summary: '요약' })
  assert.deepEqual(normalized.events, [])
  assert.equal(normalized.summary, '요약')
})

test('프롬프트 버전 상수는 고정 문자열이다', () => {
  assert.equal(SUBTITLE_METADATA_PROMPT_VERSION, 'subtitle-metadata-v1')
})