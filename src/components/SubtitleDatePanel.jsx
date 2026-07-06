/**
 * src/components/SubtitleDatePanel.jsx
 * 자막 수정일별 묶음 패널
 */
import { useMemo, useState } from 'react'
import { formatMonthDay, getLocalDateKey, getPrimaryActor } from '../utils/format.js'

const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']

function groupBySubtitleDate(videos) {
  const groups = new Map()

  for (const video of videos) {
    const dateKey = getLocalDateKey(video.subtitle_added_at)
    if (!dateKey) continue
    const group = groups.get(dateKey) || {
      dateKey,
      label: formatMonthDay(video.subtitle_added_at),
      items: [],
    }
    group.items.push(video)
    groups.set(dateKey, group)
  }

  return [...groups.values()]
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .map((group) => ({
      ...group,
      count: group.items.length,
      items: group.items.sort((a, b) => {
        const actorA = String(getPrimaryActor(a.actor_name) || '')
        const actorB = String(getPrimaryActor(b.actor_name) || '')
        const actorCompare = actorA.localeCompare(actorB, 'ko-KR')
        if (actorCompare !== 0) return actorCompare

        const nameA = String(a.file_name || '')
        const nameB = String(b.file_name || '')
        return nameA.localeCompare(nameB, 'ko-KR')
      }),
    }))
}

function parseDateKey(dateKey) {
  if (!dateKey) return null
  const date = new Date(`${dateKey}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatMonthLabel(dateKey) {
  const date = parseDateKey(dateKey)
  if (!date) return '-'
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })
}

function getMonthKey(dateKey) {
  if (!dateKey) return ''
  return dateKey.slice(0, 7)
}

function startOfMonthKey(monthKey) {
  return `${monthKey}-01`
}

function addMonths(monthKey, delta) {
  const base = parseDateKey(startOfMonthKey(monthKey))
  if (!base) return monthKey
  base.setMonth(base.getMonth() + delta)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`
}

function getMonthRange(groups) {
  if (groups.length === 0) return { minMonthKey: '', maxMonthKey: '' }

  const sortedDates = groups.map((group) => group.dateKey).sort((a, b) => a.localeCompare(b))
  return {
    minMonthKey: getMonthKey(sortedDates[0]),
    maxMonthKey: getMonthKey(sortedDates[sortedDates.length - 1]),
  }
}

function buildCalendarCells(monthKey, groupsByDate) {
  const firstDay = parseDateKey(startOfMonthKey(monthKey))
  if (!firstDay) return []

  const year = firstDay.getFullYear()
  const month = firstDay.getMonth()
  const startOffset = (firstDay.getDay() + 6) % 7
  const firstCell = new Date(year, month, 1 - startOffset)
  const cells = []

  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(firstCell)
    cellDate.setDate(firstCell.getDate() + index)
    const dateKey = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`
    const inMonth = cellDate.getMonth() === month
    const group = groupsByDate.get(dateKey) || null
    cells.push({
      dateKey,
      day: cellDate.getDate(),
      inMonth,
      count: group?.count || 0,
      group,
    })
  }

  return cells
}

export default function SubtitleDatePanel({ videos, selectedDateKey, onSelectDate }) {
  const groups = useMemo(() => groupBySubtitleDate(videos), [videos])
  const groupsByDate = useMemo(
    () => new Map(groups.map((group) => [group.dateKey, group])),
    [groups]
  )

  const totalSubtitleCount = useMemo(
    () => videos.filter((video) => getLocalDateKey(video.subtitle_added_at)).length,
    [videos]
  )

  const summaryByYear = useMemo(() => {
    const yearMap = new Map()

    for (const group of groups) {
      const year = group.dateKey.slice(0, 4)
      const monthKey = getMonthKey(group.dateKey)
      const current = yearMap.get(year) || {
        count: 0,
        monthMap: new Map(),
      }

      current.count += group.count
      current.monthMap.set(monthKey, (current.monthMap.get(monthKey) || 0) + group.count)
      yearMap.set(year, current)
    }

    return [...yearMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([year, data]) => {
        const topMonthEntry = [...data.monthMap.entries()]
          .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0] || null

        return {
          year,
          count: data.count,
          topMonthKey: topMonthEntry?.[0] || '',
          topMonthCount: topMonthEntry?.[1] || 0,
        }
      })
  }, [groups])

  const monthKeys = useMemo(() => {
    const keys = [...new Set(groups.map((group) => getMonthKey(group.dateKey)))].sort((a, b) => a.localeCompare(b))
    return keys
  }, [groups])

  const { minMonthKey, maxMonthKey } = useMemo(() => getMonthRange(groups), [groups])

  const latestMonthKey = monthKeys[monthKeys.length - 1] || ''
  const selectedMonthKey = selectedDateKey ? getMonthKey(selectedDateKey) : ''
  const [activeMonthKey, setActiveMonthKey] = useState(latestMonthKey)
  const [hasManualMonthSelection, setHasManualMonthSelection] = useState(false)

  const effectiveMonthKey = (hasManualMonthSelection ? activeMonthKey : selectedMonthKey) || latestMonthKey || activeMonthKey

  const selectedGroup = groups.find((group) => group.dateKey === selectedDateKey) || null
  const calendarCells = useMemo(() => {
    if (!effectiveMonthKey) return []
    return buildCalendarCells(effectiveMonthKey, groupsByDate)
  }, [effectiveMonthKey, groupsByDate])

  const monthLabel = useMemo(() => formatMonthLabel(`${effectiveMonthKey}-01`), [effectiveMonthKey])

  const canPrevMonth = Boolean(effectiveMonthKey && minMonthKey && effectiveMonthKey > minMonthKey)
  const canNextMonth = Boolean(effectiveMonthKey && maxMonthKey && effectiveMonthKey < maxMonthKey)

  const goMonth = (delta) => {
    if (!effectiveMonthKey) return
    const nextMonth = addMonths(effectiveMonthKey, delta)
    if (minMonthKey && nextMonth < minMonthKey) return
    if (maxMonthKey && nextMonth > maxMonthKey) return
    setActiveMonthKey(nextMonth)
    setHasManualMonthSelection(true)
  }

  const goToMonth = (monthKey) => {
    if (!monthKey) return
    setActiveMonthKey(monthKey)
    setHasManualMonthSelection(true)
  }

  if (groups.length === 0) return null

  return (
    <section className="subtitle-date-panel">
      <div className="subtitle-date-panel__header">
        <span className="subtitle-date-panel__title">자막 수정일</span>
        {selectedDateKey && (
          <button
            type="button"
            className="subtitle-date-panel__clear"
            onClick={() => onSelectDate(null)}
          >
            전체 보기
          </button>
        )}
      </div>

      <div className="subtitle-date-summary">
        <div className="subtitle-date-summary__total">
          <div className="subtitle-date-summary__total-copy">
            <span className="subtitle-date-summary__label">전체 자막</span>
            <strong className="subtitle-date-summary__value">{totalSubtitleCount}개</strong>
          </div>
          <span className="subtitle-date-summary__note">연도별 분포</span>
        </div>
        <div className="subtitle-date-summary__years">
          {summaryByYear.map(({ year, count, topMonthKey, topMonthCount }) => (
            <button
              key={year}
              type="button"
              className="subtitle-date-summary__year"
              onClick={() => goToMonth(topMonthKey)}
              title={topMonthKey ? `${year}년에서 가장 많은 달: ${formatMonthLabel(`${topMonthKey}-01`)} (${topMonthCount}개)` : `${year}년 이동`}
            >
              <span className="subtitle-date-summary__year-label">{year}년</span>
              <strong className="subtitle-date-summary__year-value">{count}개</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="subtitle-date-calendar">
        <div className="subtitle-date-calendar__head">
          <button
            type="button"
            className="subtitle-date-calendar__nav"
            onClick={() => goMonth(-1)}
            disabled={!canPrevMonth}
            aria-label="이전 달"
          >
            ‹
          </button>
          <strong className="subtitle-date-calendar__month">{monthLabel}</strong>
          <button
            type="button"
            className="subtitle-date-calendar__nav"
            onClick={() => goMonth(1)}
            disabled={!canNextMonth}
            aria-label="다음 달"
          >
            ›
          </button>
        </div>

        <div className="subtitle-date-calendar__weekdays">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        <div className="subtitle-date-calendar__grid">
          {calendarCells.map((cell) => {
            const isActive = selectedDateKey === cell.dateKey
            const isSelectable = cell.count > 0
            return (
              <button
                key={cell.dateKey}
                type="button"
                className={[
                  'subtitle-date-day',
                  !cell.inMonth ? 'subtitle-date-day--outside' : '',
                  isActive ? 'subtitle-date-day--active' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  if (!isSelectable) return
                  setActiveMonthKey(getMonthKey(cell.dateKey))
                  setHasManualMonthSelection(true)
                  onSelectDate(cell.dateKey)
                }}
                disabled={!isSelectable}
                title={isSelectable ? `${cell.dateKey} · ${cell.count}개` : cell.dateKey}
              >
                <span className="subtitle-date-day__num">{cell.day}</span>
                {cell.count > 0 && (
                  <span className="subtitle-date-day__badge">{cell.count}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {selectedGroup && (
        <div className="subtitle-date-panel__detail">
          <div className="subtitle-date-panel__detail-head">
            <strong>{selectedGroup.label}</strong>
            <span>{selectedGroup.count}개</span>
          </div>
          <div className="subtitle-date-panel__items">
            {selectedGroup.items.map((video) => (
              <div key={video.id} className="subtitle-date-panel__item">
                <span className="subtitle-date-panel__item-name" title={video.file_name}>
                  {video.file_name}
                </span>
                {video.subtitle_count > 0 && (
                  <span className="subtitle-date-panel__item-meta">
                    자막 {video.subtitle_count}개
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
