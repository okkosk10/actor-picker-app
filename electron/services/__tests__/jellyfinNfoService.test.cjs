'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  escapeXml,
  mapVideoRatingToJellyfin,
  buildTagList,
  buildMovieNfo,
  writeNfoFile,
  buildExportStats,
  getNfoPath,
  buildExportSnapshot,
} = require('../jellyfinNfoService.cjs')

test('XML 특수문자는 안전하게 escape된다', () => {
  assert.equal(escapeXml(`a & b < c > d "e" 'f'`), 'a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;')
})

test('작품 평점은 5점제를 10점제로 변환한다', () => {
  assert.equal(mapVideoRatingToJellyfin(5), 10)
  assert.equal(mapVideoRatingToJellyfin(4), 8)
  assert.equal(mapVideoRatingToJellyfin(0), null)
})

test('태그는 중복 없이 합쳐진다', () => {
  const tags = buildTagList({
    tags: '즐겨찾기, 액션, 액션',
    grade: '재시청 추천',
    favorite: 1,
    ai_tags: '["액션","스릴러","스릴러"]',
  })
  assert.deepEqual(tags, ['즐겨찾기', '액션', '등급: 재시청 추천', '스릴러'])
})

test('빈 필드는 NFO에서 생략된다', () => {
  const xml = buildMovieNfo({
    code: 'SONE-123',
    rating: 0,
    grade: '',
    tags: '',
    favorite: 0,
    memo: '',
    ai_outline: '',
    ai_plot: '',
    ai_tags: '[]',
    ai_story_structure: '',
    file_path: '/tmp/SONE-123.mp4',
  }, [])

  assert.ok(xml.includes('<title>SONE-123</title>'))
  assert.ok(!xml.includes('<plot>'))
  assert.ok(!xml.includes('<tagline>'))
  assert.ok(!xml.includes('<rating>'))
})

test('단일 배우 NFO 생성과 주연 role 처리', () => {
  const xml = buildMovieNfo({
    code: 'SONE-124',
    rating: 4,
    grade: '보관',
    tags: '태그1',
    favorite: 1,
    memo: '메모',
    ai_outline: '한 줄 설명',
    ai_plot: '작품 설명',
    ai_tags: '[]',
    ai_story_structure: '',
    file_path: '/tmp/SONE-124.mp4',
  }, [{ name: '배우A', is_main: 1 }])

  assert.ok(xml.includes('<name>배우A</name>'))
  assert.ok(xml.includes('<role>주연</role>'))
  assert.ok(xml.includes('<rating>8</rating>'))
  assert.ok(xml.includes('<tagline>한 줄 설명</tagline>'))
  assert.ok(xml.includes('액트픽커 평점: 4/5'))
})

test('다중 배우는 대표 배우를 먼저 정렬한다', () => {
  const xml = buildMovieNfo({
    code: 'SONE-125',
    rating: 5,
    grade: '만족',
    tags: '',
    favorite: 0,
    memo: '',
    ai_outline: '',
    ai_plot: '',
    ai_tags: '[]',
    ai_story_structure: '',
    file_path: '/tmp/SONE-125.mp4',
  }, [
    { name: '배우B', is_main: 0, order_index: 1 },
    { name: '배우A', is_main: 1, order_index: 0 },
  ])

  const firstActorIndex = xml.indexOf('<name>배우A</name>')
  const secondActorIndex = xml.indexOf('<name>배우B</name>')
  assert.ok(firstActorIndex >= 0 && secondActorIndex >= 0)
  assert.ok(firstActorIndex < secondActorIndex)
})

test('overwrite-generated-only는 외부 NFO를 건너뛴다', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-picker-nfo-'))
  const nfoPath = path.join(tempDir, 'SONE-126.nfo')
  fs.writeFileSync(nfoPath, '<movie><title>외부</title></movie>', 'utf8')

  const result = await writeNfoFile(nfoPath, '<movie />', 'overwrite-generated-only')
  assert.equal(result.action, 'skipped')
  assert.equal(result.reason, 'external')
})

test('generated NFO만 덮어쓴다', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-picker-nfo2-'))
  const nfoPath = path.join(tempDir, 'SONE-127.nfo')
  fs.writeFileSync(nfoPath, '<!-- generated-by: actor-picker-app -->\n<movie></movie>', 'utf8')

  const result = await writeNfoFile(nfoPath, '<movie><title>재생성</title></movie>', 'overwrite-generated-only')
  assert.equal(result.action, 'overwritten')
  assert.ok(fs.readFileSync(nfoPath, 'utf8').includes('재생성'))
})

test('기존 NFO skip 정책은 파일을 건드리지 않는다', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-picker-nfo3-'))
  const nfoPath = path.join(tempDir, 'SONE-128.nfo')
  fs.writeFileSync(nfoPath, '<movie><title>기존</title></movie>', 'utf8')

  const result = await writeNfoFile(nfoPath, '<movie><title>새</title></movie>', 'skip')
  assert.equal(result.action, 'skipped')
  assert.equal(fs.readFileSync(nfoPath, 'utf8'), '<movie><title>기존</title></movie>')
})

test('NFO 경로는 basename.nfo로 생성된다', () => {
  assert.equal(getNfoPath('D:/AV/SONE-129.mp4'), path.join('D:/AV', 'SONE-129.nfo'))
})

test('통계 집계는 핵심 카운트를 계산한다', () => {
  const stats = buildExportStats([
    { videoFileExists: true, subtitleStatus: 'available', primarySubtitlePath: '/a.srt', aiSummaryStatus: 'not_analyzed', nfoExists: true, exportEligible: true, hasActorLinks: true, status: 'normal' },
    { videoFileExists: false, subtitleStatus: 'missing', primarySubtitlePath: '', aiSummaryStatus: 'stale', nfoExists: false, exportEligible: false, hasActorLinks: false, status: 'missing' },
  ])

  assert.equal(stats.totalVideos, 2)
  assert.equal(stats.videoFileExists, 1)
  assert.equal(stats.videoFileMissing, 1)
  assert.equal(stats.subtitleAvailable, 1)
  assert.equal(stats.aiNotAnalyzed, 1)
  assert.equal(stats.aiStale, 1)
  assert.equal(stats.missingActorLinks, 1)
})

test('제한된 스냅샷은 영상 기준으로 자른다', () => {
  const fakeDb = {
    prepare(sql) {
      if (sql.includes('SELECT v.id') && sql.includes('FROM videos v')) {
        return {
          all() {
            return [{ id: 1 }]
          },
        }
      }

      return {
        all() {
          return [
            {
              id: 1,
              file_name: 'ONE.mp4',
              file_path: '/tmp/ONE.mp4',
              folder_path: '/tmp',
              code: 'ONE',
              actor_name: '',
              tags: '',
              memo: '',
              rating: 0,
              favorite: 0,
              grade: '보관',
              status: 'normal',
              size: 0,
              subtitle_paths: '[]',
              subtitle_files: '[]',
              subtitle_exts: '',
              subtitle_count: 0,
              subtitle_size: 0,
              subtitle_added_at: null,
              primary_subtitle_path: '',
              primary_subtitle_hash: '',
              subtitle_status: 'missing',
              ai_outline: '',
              ai_plot: '',
              ai_tags: '[]',
              ai_story_structure: '',
              ai_summary_status: 'not_analyzed',
              ai_summary_source_path: '',
              ai_summary_source_hash: '',
              ai_summary_updated_at: null,
              is_main: 1,
              order_index: 0,
              actor_id: 1,
              actor_name_joined: '배우A',
              actor_rating: 0,
              aliases: '',
            },
            {
              id: 1,
              file_name: 'ONE.mp4',
              file_path: '/tmp/ONE.mp4',
              folder_path: '/tmp',
              code: 'ONE',
              actor_name: '',
              tags: '',
              memo: '',
              rating: 0,
              favorite: 0,
              grade: '보관',
              status: 'normal',
              size: 0,
              subtitle_paths: '[]',
              subtitle_files: '[]',
              subtitle_exts: '',
              subtitle_count: 0,
              subtitle_size: 0,
              subtitle_added_at: null,
              primary_subtitle_path: '',
              primary_subtitle_hash: '',
              subtitle_status: 'missing',
              ai_outline: '',
              ai_plot: '',
              ai_tags: '[]',
              ai_story_structure: '',
              ai_summary_status: 'not_analyzed',
              ai_summary_source_path: '',
              ai_summary_source_hash: '',
              ai_summary_updated_at: null,
              is_main: 0,
              order_index: 1,
              actor_id: 2,
              actor_name_joined: '배우B',
              actor_rating: 0,
              aliases: '',
            },
          ]
        },
      }
    },
  }

  const snapshot = buildExportSnapshot(fakeDb, { limit: 1 })
  assert.equal(snapshot.items.length, 1)
  assert.equal(snapshot.items[0].id, 1)
})

test('export summary는 missingVideo를 제외 항목으로 집계한다', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-picker-export-'))
  const videoPath = path.join(tempDir, 'SONE-130.mp4')
  fs.writeFileSync(videoPath, 'video', 'utf8')

  const fakeDb = {
    prepare(sql) {
      if (sql.includes('SELECT v.id') && sql.includes('FROM videos v')) {
        return {
          all() {
            return [{ id: 1 }, { id: 2 }]
          },
        }
      }

      return {
        all() {
          return [
            {
              id: 1,
              file_name: 'SONE-130.mp4',
              file_path: videoPath,
              folder_path: tempDir,
              code: 'SONE-130',
              actor_name: '',
              tags: '',
              memo: '',
              rating: 4,
              favorite: 0,
              grade: '보관',
              status: 'normal',
              size: 0,
              subtitle_paths: '[]',
              subtitle_files: '[]',
              subtitle_exts: '',
              subtitle_count: 0,
              subtitle_size: 0,
              subtitle_added_at: null,
              primary_subtitle_path: '',
              primary_subtitle_hash: '',
              subtitle_status: 'missing',
              ai_outline: '',
              ai_plot: '',
              ai_tags: '[]',
              ai_story_structure: '',
              ai_summary_status: 'not_analyzed',
              ai_summary_source_path: '',
              ai_summary_source_hash: '',
              ai_summary_updated_at: null,
              is_main: 0,
              order_index: 0,
              actor_id: 1,
              actor_name_joined: '배우A',
              actor_rating: 0,
              aliases: '',
            },
            {
              id: 2,
              file_name: 'SONE-131.mp4',
              file_path: path.join(tempDir, 'SONE-131.mp4'),
              folder_path: tempDir,
              code: 'SONE-131',
              actor_name: '',
              tags: '',
              memo: '',
              rating: 0,
              favorite: 0,
              grade: '보관',
              status: 'normal',
              size: 0,
              subtitle_paths: '[]',
              subtitle_files: '[]',
              subtitle_exts: '',
              subtitle_count: 0,
              subtitle_size: 0,
              subtitle_added_at: null,
              primary_subtitle_path: '',
              primary_subtitle_hash: '',
              subtitle_status: 'missing',
              ai_outline: '',
              ai_plot: '',
              ai_tags: '[]',
              ai_story_structure: '',
              ai_summary_status: 'not_analyzed',
              ai_summary_source_path: '',
              ai_summary_source_hash: '',
              ai_summary_updated_at: null,
              is_main: 0,
              order_index: 0,
              actor_id: null,
              actor_name_joined: null,
              actor_rating: 0,
              aliases: '',
            },
          ]
        },
      }
    },
  }

  const { summary, items } = await require('../jellyfinNfoService.cjs').exportJellyfinNfo(fakeDb, { limitEligibleOnly: true, limit: 10 })
  assert.equal(summary.missingVideo, 1)
  assert.equal(summary.excludedMissingVideo, 1)
  assert.equal(items.filter((item) => item.exportEligible).length, 1)
})