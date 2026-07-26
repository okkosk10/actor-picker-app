'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  parseSubtitleContent,
  readSubtitleFile,
} = require('../subtitleParserService.cjs')

function createTempSubtitleDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'actor-picker-sub-parser-'))
}

test('SMI 기본 파싱: SYNC 블록을 cue로 변환한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/snis-809(츠바사).smi',
    content: [
      '<SAMI><BODY>',
      '<SYNC Start=1000><P Class=KRCC>안녕하세요',
      '<SYNC Start=2500><P>다음 대사',
      '</BODY></SAMI>',
    ].join('\n'),
  })

  assert.equal(result.stats.originalCueCount, 2)
  assert.equal(result.cues.length, 2)
  assert.deepEqual(result.cues[0], {
    startMs: 1000,
    endMs: 2500,
    startTime: '00:00:01',
    endTime: '00:00:02',
    text: '안녕하세요',
  })
  assert.equal(result.cues[1].text, '다음 대사')
})

test('SMI 파서는 대소문자가 다른 SYNC/START를 인식한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/sample.smi',
    content: '<sync start=1000><p>첫 대사\n<SYNC START=2000><P>둘째 대사',
  })

  assert.equal(result.cues.length, 2)
  assert.equal(result.cues[0].startMs, 1000)
  assert.equal(result.cues[1].startMs, 2000)
})

test('SMI 파서는 따옴표가 있는 Start 값을 인식한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/sample.smi',
    content: '<SYNC Start="1000"><P>A\n<SYNC START=\'2500\'><P>B',
  })

  assert.equal(result.cues.length, 2)
  assert.equal(result.cues[0].startMs, 1000)
  assert.equal(result.cues[1].startMs, 2500)
})

test('SMI 파서는 <br> 줄바꿈을 유지한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/sample.smi',
    content: '<SYNC Start=1000><P>첫 줄<br>둘째 줄\n<SYNC Start=2000><P>끝',
  })

  assert.equal(result.cues[0].text, '첫 줄\n둘째 줄')
})

test('SMI 파서는 HTML 태그와 기본 엔티티를 정리한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/sample.smi',
    content: '<SYNC Start=1000><P><font color="red">&lt;테스트&gt; &amp; "A" &#39;B&#39;</font>\n<SYNC Start=2000><P>끝',
  })

  assert.equal(result.cues[0].text, '<테스트> & "A" \'B\'')
})

test('SMI 파서는 &nbsp;만 있는 cue를 제외한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/sample.smi',
    content: '<SYNC Start=1000><P>&nbsp;\n<SYNC Start=2000><P>유효 대사',
  })

  assert.equal(result.stats.originalCueCount, 1)
  assert.equal(result.cues.length, 1)
  assert.equal(result.cues[0].text, '유효 대사')
})

test('SMI 마지막 cue는 시작 시각 +3000ms를 종료 시각으로 사용한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/sample.smi',
    content: '<SYNC Start=4000><P>마지막 줄',
  })

  assert.equal(result.cues.length, 1)
  assert.equal(result.cues[0].startMs, 4000)
  assert.equal(result.cues[0].endMs, 7000)
  assert.equal(result.cues[0].endTime, '00:00:07')
})

test('readSubtitleFile은 UTF-8 SMI를 읽는다', async () => {
  const tempDir = createTempSubtitleDir()
  const filePath = path.join(tempDir, 'utf8.smi')
  fs.writeFileSync(filePath, '<SYNC Start=1000><P>안녕하세요', 'utf8')

  const content = await readSubtitleFile(filePath)
  assert.equal(content.includes('안녕하세요'), true)
})

test('readSubtitleFile은 UTF-16 LE BOM SMI를 읽는다', async () => {
  const tempDir = createTempSubtitleDir()
  const filePath = path.join(tempDir, 'utf16le.smi')
  const body = '<SYNC Start=1000><P>안녕하세요'
  const bom = Buffer.from([0xff, 0xfe])
  const encoded = Buffer.concat([bom, Buffer.from(body, 'utf16le')])
  fs.writeFileSync(filePath, encoded)

  const content = await readSubtitleFile(filePath)
  assert.equal(content.includes('안녕하세요'), true)
})

test('기존 SRT 파서는 회귀 없이 동작한다', () => {
  const result = parseSubtitleContent({
    filePath: '/tmp/legacy.srt',
    content: '1\n00:00:01,000 --> 00:00:02,000\n안녕하세요',
  })

  assert.equal(result.cues.length, 1)
  assert.equal(result.cues[0].startMs, 1000)
  assert.equal(result.cues[0].endMs, 2000)
  assert.equal(result.cues[0].text, '안녕하세요')
})
