'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  splitSubtitleStem,
  choosePrimarySubtitleCandidate,
  scanSubtitleFolder,
  refreshSubtitleIndex,
} = require('../subtitleIndexService.cjs')

test('자막 우선순위는 basename.srt가 최우선이다', () => {
  const candidates = [
    { fileName: 'SONE-123.ko.srt', filePath: '/tmp/SONE-123.ko.srt' },
    { fileName: 'SONE-123.srt', filePath: '/tmp/SONE-123.srt' },
    { fileName: 'SONE-123.ja.srt', filePath: '/tmp/SONE-123.ja.srt' },
  ]
  const primary = choosePrimarySubtitleCandidate(candidates, 'SONE-123')
  assert.equal(primary.fileName, 'SONE-123.srt')
})

test('한국어 추정 자막은 basename.ko.srt보다 basename.kor.srt보다 뒤의 기타 한국어 후보를 우선한다', () => {
  const candidates = [
    { fileName: 'SONE-123.en.srt', filePath: '/tmp/SONE-123.en.srt' },
    { fileName: 'SONE-123.korean.srt', filePath: '/tmp/SONE-123.korean.srt' },
    { fileName: 'SONE-123.ja.srt', filePath: '/tmp/SONE-123.ja.srt' },
  ]
  const primary = choosePrimarySubtitleCandidate(candidates, 'SONE-123')
  assert.equal(primary.fileName, 'SONE-123.korean.srt')
})

test('자막 stem 분류는 언어 접미사를 인식한다', () => {
  const info = splitSubtitleStem('SONE-123', 'SONE-123.ko-KR.srt')
  assert.ok(info)
  assert.equal(info.exact, false)
})

test('scanSubtitleFolder는 대표 자막과 해시를 반환한다', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-picker-sub-'))
  const videoPath = path.join(tempDir, 'SONE-123.mp4')
  const subtitlePath = path.join(tempDir, 'SONE-123.srt')
  fs.writeFileSync(videoPath, 'video', 'utf8')
  fs.writeFileSync(subtitlePath, 'subtitle text', 'utf8')

  const result = await scanSubtitleFolder(videoPath)
  assert.equal(result.status, 'available')
  assert.equal(result.primary.fileName, 'SONE-123.srt')
  assert.equal(typeof result.primaryHash, 'string')
  assert.ok(result.primaryHash.length > 0)
})

test('refreshSubtitleIndex는 자막 갱신 결과를 반환한다', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-picker-sub-db-'))
  const videoPath = path.join(tempDir, 'SONE-124.mp4')
  const subtitlePath = path.join(tempDir, 'SONE-124.srt')
  fs.writeFileSync(videoPath, 'video', 'utf8')
  fs.writeFileSync(subtitlePath, 'subtitle text', 'utf8')

  const updates = []
  const fakeDb = {
    prepare(sql) {
      if (sql.includes('SELECT')) {
        return {
          all() {
            return [{
              id: 1,
              file_name: 'SONE-124.mp4',
              file_path: videoPath,
              folder_path: tempDir,
              status: 'normal',
              subtitle_paths: '[]',
              subtitle_files: '[]',
              subtitle_exts: '',
              subtitle_count: 0,
              subtitle_size: 0,
              subtitle_added_at: null,
              primary_subtitle_path: '',
              primary_subtitle_hash: '',
              subtitle_status: 'unknown',
              ai_outline: '',
              ai_plot: '',
              ai_tags: '[]',
              ai_story_structure: '',
              ai_summary_status: 'not_analyzed',
              ai_summary_source_path: '',
              ai_summary_source_hash: '',
              ai_summary_updated_at: null,
            }]
          },
        }
      }

      return {
        run(...args) {
          updates.push({ sql, args })
          return { changes: 1 }
        },
      }
    },
  }

  const result = await refreshSubtitleIndex(fakeDb)
  assert.equal(result.success, true)
  assert.equal(result.summary.totalVideos, 1)
  assert.equal(result.summary.subtitleAvailable, 1)
  assert.ok(updates.length > 0)
})