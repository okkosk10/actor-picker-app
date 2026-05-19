'use strict'

/**
 * electron/services/__tests__/aiThemeFolderService.test.cjs
 *
 * parseTargetSizeGB / redistributeBySize 로컬 검증 테스트
 * 실행: node electron/services/__tests__/aiThemeFolderService.test.cjs
 */

const assert = require('assert')
const { parseTargetSizeGB, redistributeBySize } = require('../themeSizeHelper.cjs')

// ─── 헬퍼 ────────────────────────────────────────────────────

function pass(name) { console.log(`  ✓ ${name}`) }
function fail(name, err) {
  console.error(`  ✗ ${name}`)
  console.error(`    ${err.message}`)
  process.exitCode = 1
}

function run(name, fn) {
  try { fn(); pass(name) } catch (e) { fail(name, e) }
}

// 테스트용 간단한 sanitize (날짜 접미사 없이 그대로 반환)
const sanitize = (s) => s

console.log('\n[parseTargetSizeGB]')

run('30GB씩', () => assert.strictEqual(parseTargetSizeGB('30GB씩'), 30))
run('30 GB씩 (공백)', () => assert.strictEqual(parseTargetSizeGB('30 GB씩'), 30))
run('30기가씩', () => assert.strictEqual(parseTargetSizeGB('30기가씩'), 30))
run('50GB 이하', () => assert.strictEqual(parseTargetSizeGB('50GB 이하'), 50))
run('100기가 단위로 폴더', () => assert.strictEqual(parseTargetSizeGB('100기가 단위로 폴더'), 100))
run('핸드폰에 넣기 좋게 40GB 이하', () => assert.strictEqual(parseTargetSizeGB('핸드폰에 넣기 좋게 40GB 이하'), 40))
run('기가바이트 단위', () => assert.strictEqual(parseTargetSizeGB('25기가바이트씩'), 25))
run('소수점 허용', () => assert.strictEqual(parseTargetSizeGB('1.5GB씩'), 1.5))
run('숫자 없으면 null', () => assert.strictEqual(parseTargetSizeGB('테마 추천해줘'), null))
run('빈 문자열이면 null', () => assert.strictEqual(parseTargetSizeGB(''), null))
run('null 입력이면 null', () => assert.strictEqual(parseTargetSizeGB(null), null))
run('대소문자 무시 (gb)', () => assert.strictEqual(parseTargetSizeGB('20gb씩'), 20))

// ─── redistributeBySize 테스트 ───────────────────────────────

console.log('\n[redistributeBySize]')

// 공통 videoMap: id 1~6, 각각 10GB
const GB = 1073741824
const videoMap = new Map([
  [1, { id: 1, fileSize: 10 * GB, rating: 3, themeScore: 50, filePath: '/a/1.mp4' }],
  [2, { id: 2, fileSize: 10 * GB, rating: 3, themeScore: 50, filePath: '/a/2.mp4' }],
  [3, { id: 3, fileSize: 10 * GB, rating: 4, themeScore: 60, filePath: '/a/3.mp4' }],
  [4, { id: 4, fileSize: 10 * GB, rating: 4, themeScore: 60, filePath: '/a/4.mp4' }],
  [5, { id: 5, fileSize: 10 * GB, rating: 2, themeScore: 40, filePath: '/a/5.mp4' }],
  [6, { id: 6, fileSize: 10 * GB, rating: 2, themeScore: 40, filePath: '/a/6.mp4' }],
])

run('targetSizeGB 없으면 원본 반환', () => {
  const theme = { title: 'A', folderName: 'A_20260519', description: '', keywords: [], actorNames: [],
    videoIds: [1, 2, 3], reason: '', confidence: 0.8, itemCount: 3, totalSizeGB: 30, avgRating: 3, avgThemeScore: 53 }
  const result = redistributeBySize([theme], videoMap, null)
  assert.strictEqual(result.length, 1)
  assert.strictEqual(result[0].title, 'A')
})

run('기준 이하 테마는 그대로 유지', () => {
  const theme = { title: 'B', folderName: 'B_20260519', description: '설명', keywords: ['k'], actorNames: [],
    videoIds: [1, 2], reason: '', confidence: 0.8, itemCount: 2, totalSizeGB: 20, avgRating: 3, avgThemeScore: 50 }
  const result = redistributeBySize([theme], videoMap, 30)
  assert.strictEqual(result.length, 1)
  assert.strictEqual(result[0].videoIds.length, 2)
})

run('초과 테마를 파트로 분할 (30GB 기준, 60GB 테마 → 2파트)', () => {
  // 영상 6개 × 10GB = 60GB → 30GB 기준이면 파트1(3개), 파트2(3개)
  const theme = { title: '테마X', folderName: '테마X_20260519', description: '원본설명', keywords: [], actorNames: [],
    videoIds: [1, 2, 3, 4, 5, 6], reason: '', confidence: 0.9, itemCount: 6, totalSizeGB: 60, avgRating: 3, avgThemeScore: 50 }
  const result = redistributeBySize([theme], videoMap, 30)
  assert.strictEqual(result.length, 2, '파트 2개로 분할돼야 함')
  assert.ok(result[0].totalSizeGB <= 30, `파트1 totalSizeGB(${result[0].totalSizeGB}) ≤ 30`)
  assert.ok(result[1].totalSizeGB <= 30, `파트2 totalSizeGB(${result[1].totalSizeGB}) ≤ 30`)
  assert.ok(result[0].title.includes('파트 1'), `파트1 제목 포함: ${result[0].title}`)
  assert.ok(result[1].title.includes('파트 2'), `파트2 제목 포함: ${result[1].title}`)
  assert.ok(result[0].description.includes('파트 1'), `파트1 설명 포함: ${result[0].description}`)
})

run('단일 영상만 있으면 분할하지 않음', () => {
  const bigMap = new Map([[7, { id: 7, fileSize: 50 * GB, rating: 4, themeScore: 70, filePath: '/a/7.mp4' }]])
  const theme = { title: 'C', folderName: 'C_20260519', description: '', keywords: [], actorNames: [],
    videoIds: [7], reason: '', confidence: 0.5, itemCount: 1, totalSizeGB: 50, avgRating: 4, avgThemeScore: 70 }
  const result = redistributeBySize([theme], bigMap, 30)
  assert.strictEqual(result.length, 1, '단일 영상은 분할하지 않음')
})

run('여러 테마 중 일부만 분할', () => {
  const small = { title: 'Small', folderName: 'Small_20260519', description: '', keywords: [], actorNames: [],
    videoIds: [1], reason: '', confidence: 0.8, itemCount: 1, totalSizeGB: 10, avgRating: 3, avgThemeScore: 50 }
  const big   = { title: 'Big', folderName: 'Big_20260519', description: '', keywords: [], actorNames: [],
    videoIds: [2, 3, 4, 5, 6], reason: '', confidence: 0.8, itemCount: 5, totalSizeGB: 50, avgRating: 3, avgThemeScore: 50 }
  const result = redistributeBySize([small, big], videoMap, 30)
  // small → 그대로, big → 파트 분할
  assert.ok(result.some(t => t.title === 'Small'), 'Small 테마 유지')
  assert.ok(result.some(t => t.title.includes('Big') && t.title.includes('파트')), 'Big 테마 분할')
  for (const t of result) {
    assert.ok(t.totalSizeGB <= 30, `모든 테마 ≤ 30GB: ${t.title} = ${t.totalSizeGB}GB`)
  }
})

run('분할된 파트들의 videoId 합집합 = 원본 videoIds', () => {
  const theme = { title: '전체', folderName: '전체_20260519', description: '', keywords: [], actorNames: [],
    videoIds: [1, 2, 3, 4, 5, 6], reason: '', confidence: 0.9, itemCount: 6, totalSizeGB: 60, avgRating: 3, avgThemeScore: 50 }
  const result = redistributeBySize([theme], videoMap, 30)
  const allIds = result.flatMap(t => t.videoIds).sort((a, b) => a - b)
  assert.deepStrictEqual(allIds, [1, 2, 3, 4, 5, 6], '영상 유실 없음')
})

// ─── 결과 ─────────────────────────────────────────────────────

const exitCode = process.exitCode || 0
console.log(`\n테스트 완료 (exit code: ${exitCode})\n`)
