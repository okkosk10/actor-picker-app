'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PARSER_PROFILES,
  normalizeUncensoredCode,
  parseFileName,
} = require('../../parser.cjs')

test('기본 프로필은 기존 품번과 배우명 규칙을 유지한다', () => {
  const parsed = parseFileName('ABS-139(사쿠야 유아).mp4')
  assert.equal(parsed.code, 'ABS-139')
  assert.equal(parsed.actor_name, '사쿠야 유아')
  assert.equal(parsed.parser_profile, PARSER_PROFILES.DEFAULT)
})

test('노모 프로필은 FC2 표기를 정규화하고 분할 번호를 보존한다', () => {
  const cases = [
    ['FC2-PPV-1851396.mp4', 'FC2-PPV-1851396'],
    ['FC2PPV 3834098.mp4', 'FC2-PPV-3834098'],
    ['FC2P-PV-1040158(우에하라 미즈호).mp4', 'FC2-PPV-1040158'],
    ['FC2_2537990.mp4', 'FC2-2537990'],
    ['FC2-PPV-2989496_2.mp4', 'FC2-PPV-2989496_2'],
    ['FC2PPV 4025269-1-2.mp4', 'FC2-PPV-4025269_1_2'],
  ]

  for (const [fileName, expected] of cases) {
    assert.equal(
      parseFileName(fileName, PARSER_PROFILES.UNCENSORED_FC2).code,
      expected,
    )
  }
})

test('노모 프로필은 숫자 괄호를 배우로 만들지 않는다', () => {
  const parsed = parseFileName(
    'FC2-2670228(2360858).mp4',
    PARSER_PROFILES.UNCENSORED_FC2,
  )
  assert.equal(parsed.code, 'FC2-2670228')
  assert.equal(parsed.actor_name, null)
  assert.equal(parsed.reference_id, '2360858')
  assert.equal(parsed.actor_resolution_status, 'not_provided')
})

test('노모 프로필은 복수 배우와 분할 꼬리 번호를 정리한다', () => {
  const parsed = parseFileName(
    '교복(하나자와 히마리_2, 미사키).wmv',
    PARSER_PROFILES.UNCENSORED_FC2,
  )
  assert.equal(parsed.code, '교복')
  assert.deepEqual(parsed.actor_candidates, ['하나자와 히마리', '미사키'])
  assert.equal(parsed.actor_name, '하나자와 히마리, 미사키')
})

test('노모 프로필은 1Pondo와 Caribbeancom 날짜형 품번을 정규화한다', () => {
  assert.equal(normalizeUncensoredCode('022221_001-1pon'), '1PONDO-022221_001')
  assert.equal(normalizeUncensoredCode('1pondo - 092415_159'), '1PONDO-092415_159')
  assert.equal(normalizeUncensoredCode('091120-001-carib'), 'CARIB-091120_001')
})

test('노모 프로필은 파일명 자체가 배우명인 형식을 배우 후보로 추출한다', () => {
  const cases = [
    ['tachibana ririko.mp4', 'tachibana ririko'],
    ['사쿠라바 노도카_노모.mp4', '사쿠라바 노도카'],
    ['사쿠라이 미루.mp4', '사쿠라이 미루'],
    ['시로사키 아오이 옷집_노모.mp4', '시로사키 아오이'],
    ['아이네 마리아_노모.mp4', '아이네 마리아'],
    ['아이자와 아리사_노모.mp4', '아이자와 아리사'],
    ['유키무라 카린.mp4', '유키무라 카린'],
    ['키쿠카와 미츠하_노모.mp4', '키쿠카와 미츠하'],
  ]

  for (const [fileName, actorName] of cases) {
    const parsed = parseFileName(fileName, PARSER_PROFILES.UNCENSORED_FC2)
    assert.equal(parsed.code, null)
    assert.equal(parsed.actor_name, actorName)
    assert.deepEqual(parsed.actor_candidates, [actorName])
  }
})

test('노모 프로필은 일반 상황 제목을 배우명으로 추정하지 않는다', () => {
  const files = [
    '2인_노모.mp4',
    '메이드_노모.mp4',
    '미시_노모.mp4',
    '성우지망생1_노모.mp4',
    '웨이브녀_노모.mp4',
    'fc1424799.mp4',
  ]

  for (const fileName of files) {
    const parsed = parseFileName(fileName, PARSER_PROFILES.UNCENSORED_FC2)
    assert.equal(parsed.actor_name, null)
  }
})
