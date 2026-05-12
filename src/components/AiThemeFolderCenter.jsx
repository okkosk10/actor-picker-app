/**
 * src/components/AiThemeFolderCenter.jsx
 * AI 특집 폴더 생성 UI
 *
 * 흐름:
 *   1. "AI 특집 생성" → generateAiThemeFolders() IPC
 *   2. 테마 카드 표시 + 체크박스 선택
 *   3. "대상 폴더 선택" → selectFolder() IPC
 *   4. "선택한 특집 폴더 생성" → createAiThemeFolders() IPC
 */

import { useState, useCallback, useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────────────────────
function fmtGB(gb) {
  if (!gb && gb !== 0) return '—'
  return `${Number(gb).toFixed(2)} GB`
}

function fmtRating(r) {
  if (!r) return '—'
  return `${'★'.repeat(Math.round(r))} (${Number(r).toFixed(1)})`
}

// ─────────────────────────────────────────────────────────────
// 로딩 화면 (AI 분석 / 복사 진행 공용)
// ─────────────────────────────────────────────────────────────

/**
 * mode: 'generate' | 'copy'
 * copyTotal: 복사할 테마 수 (mode=copy일 때)
 */
function LoadingScreen({ mode, copyTotal = 0 }) {
  const GEN_STEPS = [
    { label: 'DB에서 영상 데이터 불러오는 중…',   sub: '전체 영상, 배우, 활동 통계를 조회합니다.' },
    { label: '후보 점수 계산 중…',               sub: 'watchScore / copyScore / themeScore를 계산합니다.' },
    { label: 'AI에 특집 분석 요청 중…',           sub: '상위 후보를 OpenAI에 전달합니다.' },
    { label: 'AI 응답 대기 중…',                 sub: 'AI가 테마를 구성하고 있습니다. 잠시만 기다려주세요.' },
    { label: 'AI가 열심히 분석하고 있습니다…',    sub: '영상 수가 많을수록 시간이 걸릴 수 있습니다.' },
  ]
  // 단계 전환 타이밍 (ms)
  const STEP_TIMING = [0, 1200, 2600, 4500, 8000]

  const [stepIdx, setStepIdx] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    if (mode !== 'generate') return
    setStepIdx(0)
    let i = 1
    function advance() {
      if (i >= STEP_TIMING.length) return
      timerRef.current = setTimeout(() => {
        setStepIdx(i)
        i++
        advance()
      }, i < STEP_TIMING.length ? STEP_TIMING[i] - STEP_TIMING[i - 1] : 99999)
    }
    advance()
    return () => clearTimeout(timerRef.current)
  }, [mode])

  const step   = mode === 'generate' ? GEN_STEPS[stepIdx] : null
  const pct    = mode === 'generate' ? Math.round((stepIdx / (GEN_STEPS.length - 1)) * 70) : null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '52px 24px',
        gap: 24,
      }}
    >
      {/* 스피너 */}
      <div className="ai-spinner" />

      {/* 상태 텍스트 */}
      {mode === 'generate' && step && (
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#c8d0ff', marginBottom: 6 }}>
            {step.label}
          </div>
          <div style={{ fontSize: 12, color: '#666' }}>
            {step.sub}
          </div>
        </div>
      )}
      {mode === 'copy' && (
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#a0f0b0', marginBottom: 6 }}>
            선택한 특집 폴더를 복사하는 중…
          </div>
          <div style={{ fontSize: 12, color: '#666' }}>
            {copyTotal}개 테마의 파일을 대상 폴더에 복사합니다. 원본은 삭제되지 않습니다.
          </div>
        </div>
      )}

      {/* 진행 바 */}
      <div className="ai-progress-track" style={{ width: 320 }}>
        {mode === 'generate' ? (
          <>
            {/* 실제 단계 기반 fill + shimmer */}
            <div className="ai-progress-fill" style={{ width: `${pct}%` }} />
            <div className="ai-progress-shimmer" />
          </>
        ) : (
          /* 복사는 완전 indeterminate */
          <div className="ai-progress-shimmer" />
        )}
      </div>

      {/* 단계 도트 (generate 전용) */}
      {mode === 'generate' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {GEN_STEPS.map((s, i) => (
            <div
              key={i}
              title={s.label}
              style={{
                width: i === stepIdx ? 10 : 7,
                height: i === stepIdx ? 10 : 7,
                borderRadius: '50%',
                background: i < stepIdx ? '#4f6ef7' : i === stepIdx ? '#818cf8' : '#2a2a3a',
                transition: 'all 0.3s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 신뢰도 바
// ─────────────────────────────────────────────────────────────
function ConfidenceBar({ value }) {
  const pct = Math.round((value ?? 0.5) * 100)
  const color = pct >= 80 ? '#52c41a' : pct >= 60 ? '#faad14' : '#ff7875'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, color: '#aaa' }}>신뢰도</span>
      <span
        style={{
          display: 'inline-block',
          width: 80,
          height: 6,
          background: '#2a2a2a',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: 3,
          }}
        />
      </span>
      <span style={{ fontSize: 12, color }}>{pct}%</span>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// 파일 목록 (접기/펼치기)
// ─────────────────────────────────────────────────────────────
function ThemeFileList({ videoIds, videoMap }) {
  const [open, setOpen] = useState(false)
  if (!videoIds || videoIds.length === 0) return null
  const items = videoIds.map(id => videoMap[id]).filter(Boolean)

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none',
          border: 'none',
          color: '#888',
          cursor: 'pointer',
          fontSize: 12,
          padding: '2px 0',
        }}
      >
        {open ? '▲ 파일 목록 접기' : `▼ 파일 목록 보기 (${videoIds.length}개)`}
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            maxHeight: 260,
            overflowY: 'auto',
            border: '1px solid #2a2a2a',
            borderRadius: 4,
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#1a1a1a', color: '#aaa' }}>
                <th style={TH}>파일명</th>
                <th style={TH}>배우</th>
                <th style={TH}>태그</th>
                <th style={TH}>별점</th>
                <th style={TH}>재생</th>
                <th style={TH}>복사</th>
                <th style={TH}>점수</th>
                <th style={TH}>폴더</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v, i) => (
                <tr
                  key={v.id}
                  style={{ background: i % 2 === 0 ? '#111' : '#161616', color: '#ccc' }}
                >
                  <td style={TD} title={v.fileName}>{truncate(v.fileName, 40)}</td>
                  <td style={TD}>{v.actors || '—'}</td>
                  <td style={TD}>{(v.tags ?? []).join(', ') || '—'}</td>
                  <td style={{ ...TD, textAlign: 'center' }}>{v.rating ?? '—'}</td>
                  <td style={{ ...TD, textAlign: 'center' }}>{v.playCount ?? 0}</td>
                  <td style={{ ...TD, textAlign: 'center' }}>{v.copyCount ?? 0}</td>
                  <td style={{ ...TD, textAlign: 'center', color: '#faad14' }}>{v.themeScore ?? '—'}</td>
                  <td style={TD} title={v.folderName}>{truncate(v.folderName ?? '', 20)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const TH = { padding: '4px 8px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }
const TD = { padding: '3px 8px', verticalAlign: 'top', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const truncate = (s, n) => s.length > n ? s.slice(0, n) + '…' : s

// ─────────────────────────────────────────────────────────────
// 테마 카드
// ─────────────────────────────────────────────────────────────
function ThemeCard({ theme, checked, onCheck, videoMap }) {
  return (
    <div
      style={{
        border: `2px solid ${checked ? '#1668dc' : '#2a2a2a'}`,
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 12,
        background: checked ? '#0d1a2f' : '#141414',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* 체크박스 */}
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onCheck(theme.folderName, e.target.checked)}
          style={{ width: 18, height: 18, marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
        />

        {/* 본문 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 제목 행 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8' }}>{theme.title}</span>
            <ConfidenceBar value={theme.confidence} />
          </div>

          {/* 폴더명 */}
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
            📁 {theme.folderName}
          </div>

          {/* 설명 */}
          {theme.description && (
            <div style={{ fontSize: 13, color: '#aaa', marginTop: 6 }}>{theme.description}</div>
          )}

          {/* 키워드 / 배우 */}
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(theme.keywords ?? []).map(k => (
              <span key={k} style={TAG_STYLE}>{k}</span>
            ))}
            {(theme.actorNames ?? []).map(a => (
              <span key={a} style={{ ...TAG_STYLE, background: '#1a2a1a', color: '#73d13d' }}>👤 {a}</span>
            ))}
          </div>

          {/* 통계 */}
          <div style={{ display: 'flex', gap: 20, marginTop: 10, flexWrap: 'wrap', fontSize: 13 }}>
            <Stat label="영상 수"    value={`${theme.itemCount ?? 0}개`} />
            <Stat label="총 용량"    value={fmtGB(theme.totalSizeGB)} />
            <Stat label="평균 별점"  value={fmtRating(theme.avgRating)} />
            <Stat label="평균 점수"  value={theme.avgThemeScore ?? '—'} />
          </div>

          {/* 이유 */}
          {theme.reason && (
            <div style={{ fontSize: 12, color: '#777', marginTop: 8, fontStyle: 'italic' }}>
              💬 {theme.reason}
            </div>
          )}

          {/* 파일 목록 */}
          <ThemeFileList videoIds={theme.videoIds} videoMap={videoMap} />
        </div>
      </div>
    </div>
  )
}

const TAG_STYLE = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 12,
  background: '#1a2840',
  color: '#69b1ff',
  fontSize: 12,
}

function Stat({ label, value }) {
  return (
    <span>
      <span style={{ color: '#666', marginRight: 4 }}>{label}</span>
      <span style={{ color: '#ccc', fontWeight: 600 }}>{value}</span>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// 복사 결과 요약
// ─────────────────────────────────────────────────────────────
function CopyResultSummary({ results }) {
  if (!results || results.length === 0) return null
  return (
    <div
      style={{
        marginTop: 16,
        padding: '12px 16px',
        background: '#0f1f0f',
        border: '1px solid #2a4a2a',
        borderRadius: 6,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8, color: '#73d13d' }}>📂 복사 완료</div>
      {results.map((r, i) => (
        <div key={i} style={{ marginBottom: 8, fontSize: 13 }}>
          <div style={{ color: '#e8e8e8' }}>
            <strong>{r.themeTitle}</strong>
            {' → '}
            <span style={{ color: '#888', fontFamily: 'monospace', fontSize: 11 }}>{r.folderPath}</span>
          </div>
          <div style={{ marginTop: 2, color: r.failedCount > 0 ? '#ff7875' : '#73d13d' }}>
            ✅ {r.copiedCount}개 복사 성공
            {r.failedCount > 0 && ` / ❌ ${r.failedCount}개 실패`}
          </div>
          {r.failedItems?.length > 0 && (
            <ul style={{ marginTop: 4, paddingLeft: 16, color: '#ff7875', fontSize: 12 }}>
              {r.failedItems.map((f, j) => (
                <li key={j}>{f.filePath || `videoId=${f.videoId}`}: {f.reason}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────
export default function AiThemeFolderCenter() {
  const [generating,     setGenerating]     = useState(false)
  const [themes,         setThemes]         = useState(null)   // null = 아직 생성 안 함
  const [error,          setError]          = useState(null)
  const [candidateCount, setCandidateCount] = useState(0)

  // 비디오 맵 (파일 목록 표시용)
  const [videoMap, setVideoMap] = useState({})

  // 체크된 테마 folderName 집합
  const [checked, setChecked] = useState(new Set())

  // 대상 폴더
  const [targetPath, setTargetPath] = useState('')

  // 복사 진행
  const [copying,     setCopying]     = useState(false)
  const [copyResults, setCopyResults] = useState(null)

  // ── 전체 선택/해제 ────────────────────────────────────────────
  const allChecked = themes && themes.length > 0 && checked.size === themes.length
  const toggleAll  = () => {
    if (allChecked) {
      setChecked(new Set())
    } else {
      setChecked(new Set(themes.map(t => t.folderName)))
    }
  }

  // ── AI 특집 생성 ──────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    setThemes(null)
    setChecked(new Set())
    setCopyResults(null)

    try {
      const result = await window.api.generateAiThemeFolders()
      if (!result.success) {
        setError(result.error ?? 'AI 특집 생성에 실패했습니다.')
        return
      }
      setThemes(result.themes)
      setCandidateCount(result.candidateCount ?? 0)
      // 모두 기본 체크
      setChecked(new Set(result.themes.map(t => t.folderName)))
    } catch (e) {
      setError(e.message || '알 수 없는 오류')
    } finally {
      setGenerating(false)
    }
  }, [])

  // ── 대상 폴더 선택 ────────────────────────────────────────────
  const handleSelectTarget = useCallback(async () => {
    try {
      const result = await window.api.selectFolder()
      if (result) setTargetPath(result)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // ── 체크 토글 ─────────────────────────────────────────────────
  const handleCheck = useCallback((folderName, val) => {
    setChecked(prev => {
      const next = new Set(prev)
      val ? next.add(folderName) : next.delete(folderName)
      return next
    })
  }, [])

  // ── 폴더 복사 실행 ────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!targetPath) { setError('대상 폴더를 먼저 선택하세요.'); return }
    if (checked.size === 0) { setError('복사할 테마를 하나 이상 선택하세요.'); return }

    setCopying(true)
    setError(null)
    setCopyResults(null)

    const selected = (themes ?? []).filter(t => checked.has(t.folderName))

    try {
      const result = await window.api.createAiThemeFolders(targetPath, selected)
      if (!result.success) {
        setError(result.error ?? '복사에 실패했습니다.')
        return
      }
      setCopyResults(result.results)
    } catch (e) {
      setError(e.message || '알 수 없는 오류')
    } finally {
      setCopying(false)
    }
  }, [themes, checked, targetPath])

  // ─────────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 28px', maxWidth: 900, margin: '0 auto' }}>
      {/* 제목 */}
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6, color: '#e8e8e8' }}>
        🎬 AI 특집 폴더 생성
      </h2>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
        별점, 태그, 배우, 재생/복사 빈도를 분석해 AI가 특집 폴더를 제안합니다.
        원본 파일은 삭제되지 않습니다.
      </p>

      {/* 액션 버튼 행 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <button
          className="btn-primary"
          onClick={handleGenerate}
          disabled={generating}
          style={BTN}
        >
          {generating ? '⏳ AI 분석 중…' : '✨ AI 특집 생성'}
        </button>

        <button
          className="btn-secondary"
          onClick={handleSelectTarget}
          disabled={generating || copying}
          style={BTN}
        >
          📁 대상 폴더 선택
        </button>

        <button
          className="btn-primary"
          onClick={handleCreate}
          disabled={copying || !themes || checked.size === 0 || !targetPath}
          style={{ ...BTN, background: '#135200' }}
        >
          {copying ? '⏳ 복사 중…' : `📂 선택한 특집 폴더 생성 (${checked.size}개)`}
        </button>
      </div>

      {/* 대상 폴더 표시 */}
      {targetPath && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          📂 복사 대상: <span style={{ color: '#ccc', fontFamily: 'monospace' }}>{targetPath}</span>
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            marginBottom: 16,
            background: '#2a1010',
            border: '1px solid #5c2020',
            borderRadius: 6,
            color: '#ff7875',
            fontSize: 13,
          }}
        >
          ❌ {error}
        </div>
      )}

      {/* 복사 결과 */}
      <CopyResultSummary results={copyResults} />

      {/* ── AI 생성 로딩 ── */}
      {generating && <LoadingScreen mode="generate" />}

      {/* ── 복사 로딩 ── */}
      {copying && <LoadingScreen mode="copy" copyTotal={checked.size} />}

      {/* 결과 없음 */}
      {!generating && !copying && themes !== null && themes.length === 0 && (
        <div style={{ color: '#888', padding: 24 }}>
          유효한 테마를 찾지 못했습니다. 영상 데이터를 더 추가한 뒤 다시 시도해보세요.
        </div>
      )}

      {/* 테마 목록 */}
      {!generating && !copying && themes && themes.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <span style={{ color: '#aaa', fontSize: 13 }}>
              후보 {candidateCount}개 분석 → <strong style={{ color: '#e8e8e8' }}>{themes.length}개 테마</strong> 제안됨
            </span>
            <button
              type="button"
              onClick={toggleAll}
              style={{
                background: 'none',
                border: '1px solid #333',
                borderRadius: 4,
                color: '#aaa',
                cursor: 'pointer',
                padding: '3px 10px',
                fontSize: 12,
              }}
            >
              {allChecked ? '전체 해제' : '전체 선택'}
            </button>
          </div>

          {themes.map(theme => (
            <ThemeCard
              key={theme.folderName}
              theme={theme}
              checked={checked.has(theme.folderName)}
              onCheck={handleCheck}
              videoMap={videoMap}
            />
          ))}
        </>
      )}
    </div>
  )
}

const BTN = {
  padding: '7px 16px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
  border: 'none',
}
