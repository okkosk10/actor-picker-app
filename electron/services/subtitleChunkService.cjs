'use strict'

function formatChunkLine(cue) {
  return `[${cue.startTime}] ${cue.text}`
}

function chunkSubtitleCues(cues, options = {}) {
  const maxChars = Number.isFinite(Number(options.maxChars)) && Number(options.maxChars) > 0
    ? Number(options.maxChars)
    : 12000
  const minTailChars = Number.isFinite(Number(options.minTailChars)) && Number(options.minTailChars) >= 0
    ? Number(options.minTailChars)
    : 1600

  const normalized = Array.isArray(cues) ? cues.filter((cue) => cue && cue.text) : []
  if (normalized.length === 0) {
    return { chunks: [], chunkCount: 0 }
  }

  const chunks = []
  let current = []
  let currentLength = 0

  const pushCurrent = () => {
    if (current.length === 0) return
    const text = current.map(formatChunkLine).join('\n')
    chunks.push({
      chunkIndex: chunks.length + 1,
      startTime: current[0].startTime,
      endTime: current[current.length - 1].endTime,
      text,
      cueCount: current.length,
    })
    current = []
    currentLength = 0
  }

  for (const cue of normalized) {
    const line = formatChunkLine(cue)
    const lineLength = line.length + 1

    if (current.length > 0 && currentLength + lineLength > maxChars) {
      pushCurrent()
    }

    current.push(cue)
    currentLength += lineLength
  }

  pushCurrent()

  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1]
    if (last.text.length < minTailChars) {
      const prev = chunks[chunks.length - 2]
      prev.text += `\n${last.text}`
      prev.endTime = last.endTime
      prev.cueCount += last.cueCount
      chunks.pop()
    }
  }

  return {
    chunks: chunks.map((chunk, index) => ({
      ...chunk,
      chunkIndex: index + 1,
      chunkCount: chunks.length,
    })),
    chunkCount: chunks.length,
  }
}

module.exports = {
  formatChunkLine,
  chunkSubtitleCues,
}