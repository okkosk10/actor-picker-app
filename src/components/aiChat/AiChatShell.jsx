'use strict'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Drawer, Tag } from 'antd'
import { useAiChat } from '../../hooks/useAiChat.js'
import './aiChat.css'

const EXAMPLE_PROMPTS = {
  library: ['별점 높은 영상 찾아줘', '아직 복사하지 않은 영상만 보여줘', '선택한 영상 기준으로 추천해줘', '삭제 후보 추려줘'],
  actors: ['메타데이터가 부족한 배우 찾아줘', '별점 4점 이상 배우만 보여줘', '태그가 비어 있는 배우 찾아줘'],
  storage: ['현재 드라이브 용량 알려줘', '드라이브별 저장소 통계를 보여줘', '삭제 후보가 많은 드라이브를 알려줘'],
  dashboard: ['가장 삭제 후보가 많은 드라이브 알려줘', '요약해서 보여줘'],
  recommendations: ['미복사 고평점 추천해줘', '재시청 추천 보여줘', '배우 별점 높은 작품 찾아줘'],
  default: ['별점 높은 영상 찾아줘', '삭제 후보 추려줘', '현재 드라이브 용량 알려줘'],
}

function getExamples(page) {
  return EXAMPLE_PROMPTS[page] || EXAMPLE_PROMPTS.default
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function getPageLabel(page) {
  const map = {
    library: '영상 관리',
    actors: '배우 관리',
    'actor-tags': '배우 태그 일괄 관리',
    subtitles: '자막 보관소',
    recommendations: '추천·탐색',
    dashboard: '대시보드',
    storage: '저장소 관리',
  }
  return map[page] || 'Actor Picker'
}

function ToolResultCard({ message, onAction }) {
  const resultType = message?.resultType
  const data = message?.data || {}
  const summaryCard = data.summary || null
  const highlights = Array.isArray(data.highlights) ? data.highlights : []
  const insights = Array.isArray(data.insights) ? data.insights : []
  const suggestedActions = Array.isArray(data.suggestedActions) ? data.suggestedActions : []
  const clarification = data.clarification || null

  const runAction = async (action) => {
    if (!action || typeof onAction !== 'function') return
    await onAction(action)
  }

  const buildScopedSubtitleQueryAction = (label, videoIds) => {
    const ids = Array.isArray(videoIds)
      ? videoIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : []
    return {
      id: `query-${label}`,
      type: 'client_filter_video_ids',
      label,
      payload: { videoIds: ids },
      disabled: ids.length === 0,
      disabledReason: ids.length === 0 ? '조회 가능한 영상이 없습니다.' : '',
    }
  }

  const renderSummaryHeader = () => (
    <>
      {summaryCard && (
        <>
          <div className="ai-chat-result-card__title">{summaryCard.title}</div>
          <div className="ai-chat-result-card__summary">{summaryCard.description}</div>
          {Array.isArray(summaryCard.metrics) && summaryCard.metrics.length > 0 && (
            <div className="ai-chat-metric-grid">
              {summaryCard.metrics.map((metric) => (
                <div key={metric.key || metric.label} className="ai-chat-metric-card">
                  <div className="ai-chat-metric-card__label">{metric.label}</div>
                  <div className="ai-chat-metric-card__value">{metric.value}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {!summaryCard && (
        <>
          <div className="ai-chat-result-card__title">결과 요약</div>
          <div className="ai-chat-result-card__summary">{message.content}</div>
        </>
      )}
      {insights.length > 0 && (
        <div className="ai-chat-insight-list">
          {insights.map((insight) => (
            <div key={insight} className="ai-chat-insight-list__item">{insight}</div>
          ))}
        </div>
      )}
      {suggestedActions.length > 0 && (
        <div className="ai-chat-action-row">
          {suggestedActions.map((action) => (
            // disabledReason/description이 있으면 버튼 내 보조 텍스트로 함께 노출한다.
            <button
              key={action.id || action.label}
              type="button"
              className="ai-chat-action-btn"
              onClick={() => runAction(action)}
              disabled={typeof onAction !== 'function' || Boolean(action.disabled)}
              title={action.description || action.disabledReason || ''}
            >
              {action.label}
              {(action.description || action.disabledReason) && (
                <span className="ai-chat-action-btn__desc">{action.description || action.disabledReason}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  )

  if (resultType === 'clarification' || clarification) {
    const options = Array.isArray(clarification?.options) ? clarification.options : []
    return (
      <div className="ai-chat-result-card">
        <div className="ai-chat-result-card__title">추가 기준 필요</div>
        <div className="ai-chat-result-card__summary">{clarification?.question || message.content}</div>
        <div className="ai-chat-action-row">
          {options.map((option) => (
            // 비활성 옵션도 이유를 표시해 거짓 선택지를 방지한다.
            <button
              key={option.id || option.label}
              type="button"
              className="ai-chat-action-btn"
              onClick={() => runAction({
                id: option.id,
                type: option.type || 'refine_query',
                label: option.label,
                payload: option.payload || {},
                requiresConfirmation: Boolean(option.requiresConfirmation),
              })}
              disabled={typeof onAction !== 'function' || Boolean(option.disabled)}
              title={option.description || option.disabledReason || ''}
            >
              {option.label}
              {(option.description || option.disabledReason) && (
                <span className="ai-chat-action-btn__desc">{option.description || option.disabledReason}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (resultType === 'drive-stats') {
    return (
      <div className="ai-chat-result-card">
        {renderSummaryHeader()}
        <div className="ai-chat-drive-list">
          {(data.previewStats || []).map((drive) => (
            <div key={drive.drive} className="ai-chat-mini-card">
              <div className="ai-chat-mini-card__title">{drive.drive}</div>
              <div className="ai-chat-mini-card__body">
                영상 {drive.totalVideos}개 · {formatBytes(drive.totalSize)}
              </div>
              <div className="ai-chat-mini-card__meta">
                평균 별점 {drive.averageRating || 0} · 삭제 후보 {drive.deleteCandidateCount || 0}개
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (resultType === 'subtitle-summary') {
    return (
      <div className="ai-chat-result-card">
        {renderSummaryHeader()}
        {Array.isArray(data.folderCounts) && data.folderCounts.length > 0 && (
          <div className="ai-chat-folder-count-list">
            {data.folderCounts.map((folder) => (
              <div key={folder.folderPath} className="ai-chat-mini-card">
                <div className="ai-chat-mini-card__title">{folder.folderPath}</div>
                <div className="ai-chat-mini-card__body">자막 미매핑 {folder.count}개</div>
                {Array.isArray(folder.sampleFiles) && folder.sampleFiles.length > 0 && (
                  <div className="ai-chat-mini-card__meta">
                    예시: {folder.sampleFiles.join(' · ')}
                  </div>
                )}
                <div className="ai-chat-mini-card__actions">
                  <button
                    type="button"
                    className="ai-chat-mini-card__button"
                    onClick={() => runAction(buildScopedSubtitleQueryAction(`${folder.folderPath}만 조회`, folder.videoIds))}
                    disabled={!Array.isArray(folder.videoIds) || folder.videoIds.length === 0}
                  >
                    이 폴더만 조회
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="ai-chat-result-card__footnote">
          전체 {data.totalCount || 0}개
        </div>
      </div>
    )
  }

  if (resultType === 'actor-list') {
    return (
      <div className="ai-chat-result-card">
        {renderSummaryHeader()}
        <div className="ai-chat-mini-list">
          {(data.previewActors || []).map((actor) => (
            <div key={actor.id} className="ai-chat-mini-card">
              <div className="ai-chat-mini-card__title">{actor.name}</div>
              <div className="ai-chat-mini-card__body">
                별점 {actor.rating || 0} · 작품 {actor.videoCount || 0}개
              </div>
              <div className="ai-chat-mini-card__meta">
                {actor.agency || '소속사 없음'}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (resultType === 'delete-candidate-list') {
    return (
      <div className="ai-chat-result-card ai-chat-result-card--danger">
        {renderSummaryHeader()}
        {data.driveInfo && (
          <div className="ai-chat-result-card__footnote">
            {data.driveInfo.drive || '전체'} · 사용 용량 {formatBytes(data.driveInfo.usedByLibrary || 0)} ·
            남은 공간 {formatBytes(data.driveInfo.freeSpace || 0)}
          </div>
        )}
        {highlights.length > 0 && (
          <div className="ai-chat-highlight-list">
            {highlights.slice(0, 5).map((item, index) => (
              <div key={item.id || index} className="ai-chat-highlight-card">
                <div className="ai-chat-highlight-card__title">{index + 1}. {item.title}</div>
                <div className="ai-chat-highlight-card__body">{item.subtitle}</div>
                {Array.isArray(item.reasons) && item.reasons.length > 0 && (
                  <div className="ai-chat-highlight-card__meta">{item.reasons.join(' · ')}</div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="ai-chat-mini-list">
          {(data.previewItems || []).map((item) => (
            <div key={item.id} className="ai-chat-mini-card">
              <div className="ai-chat-mini-card__title">{item.code || item.id}</div>
                <div className="ai-chat-mini-card__body">
                  {item.file_name}{item.file_size ? ` · ${formatBytes(item.file_size)}` : ''}
                </div>
              <div className="ai-chat-mini-card__meta">{item.reason || '후보 이유 없음'}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (resultType === 'video-list') {
    return (
      <div className="ai-chat-result-card">
        {renderSummaryHeader()}
        {highlights.length > 0 && (
          <div className="ai-chat-highlight-list">
            {highlights.slice(0, 5).map((item, index) => (
              <div key={item.id || index} className="ai-chat-highlight-card">
                <div className="ai-chat-highlight-card__title">{index + 1}. {item.title}</div>
                <div className="ai-chat-highlight-card__body">{item.subtitle}</div>
                {Array.isArray(item.reasons) && item.reasons.length > 0 && (
                  <div className="ai-chat-highlight-card__meta">{item.reasons.join(' · ')}</div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="ai-chat-mini-list">
          {(data.previewItems || []).map((item) => (
            <div key={item.id} className="ai-chat-mini-card">
              <div className="ai-chat-mini-card__title">
                {item.code || item.id} · {item.rating > 0 ? `★${item.rating}` : '무별점'}
              </div>
                <div className="ai-chat-mini-card__body">
                  {item.file_name}{item.file_size ? ` · ${formatBytes(item.file_size)}` : ''}
                </div>
              <div className="ai-chat-mini-card__meta">{item.reason || item.scoreComment || '추천 결과'}</div>
            </div>
          ))}
        </div>
        {Array.isArray(data.actorSummaries) && data.actorSummaries.length > 0 && (
          <div className="ai-chat-result-card__footnote">
            배우 요약 {data.actorSummaries.length}개 포함
          </div>
        )}
      </div>
    )
  }

  if (resultType === 'subtitle-video-list') {
    const folderCounts = Array.isArray(data.folderCounts) ? data.folderCounts : []
    const actorCounts = Array.isArray(data.actorCounts) ? data.actorCounts : []
    const previewItems = Array.isArray(data.previewItems) ? data.previewItems : []

    return (
      <div className="ai-chat-result-card">
        {renderSummaryHeader()}

        {folderCounts.length > 0 && (
          <div className="ai-chat-mini-list">
            <div className="ai-chat-result-card__title">폴더별 미매핑 현황</div>
            {folderCounts.slice(0, 8).map((folder) => (
              <div key={folder.folderPath} className="ai-chat-mini-card">
                <div className="ai-chat-mini-card__title">{folder.folderPath}</div>
                <div className="ai-chat-mini-card__body">자막 미매핑 {folder.count}개</div>
                {Array.isArray(folder.sampleFiles) && folder.sampleFiles.length > 0 && (
                  <div className="ai-chat-mini-card__meta">예시: {folder.sampleFiles.join(' · ')}</div>
                )}
                <div className="ai-chat-mini-card__actions">
                  <button
                    type="button"
                    className="ai-chat-mini-card__button"
                    onClick={() => runAction(buildScopedSubtitleQueryAction(`${folder.folderPath}만 조회`, folder.videoIds))}
                    disabled={!Array.isArray(folder.videoIds) || folder.videoIds.length === 0}
                  >
                    이 폴더만 조회
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {actorCounts.length > 0 && (
          <div className="ai-chat-mini-list">
            <div className="ai-chat-result-card__title">배우별 미매핑 현황</div>
            {actorCounts.slice(0, 8).map((actor) => (
              <div key={actor.actorName} className="ai-chat-mini-card">
                <div className="ai-chat-mini-card__title">{actor.actorName}</div>
                <div className="ai-chat-mini-card__body">자막 미매핑 {actor.count}개</div>
                {Array.isArray(actor.sampleCodes) && actor.sampleCodes.length > 0 && (
                  <div className="ai-chat-mini-card__meta">예시: {actor.sampleCodes.join(' · ')}</div>
                )}
                <div className="ai-chat-mini-card__actions">
                  <button
                    type="button"
                    className="ai-chat-mini-card__button"
                    onClick={() => runAction(buildScopedSubtitleQueryAction(`${actor.actorName}만 조회`, actor.videoIds))}
                    disabled={!Array.isArray(actor.videoIds) || actor.videoIds.length === 0}
                  >
                    이 배우만 조회
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {previewItems.length > 0 && (
          <div className="ai-chat-mini-list">
            <div className="ai-chat-result-card__title">대표 파일</div>
            {previewItems.map((item) => (
              <div key={item.id} className="ai-chat-mini-card">
                <div className="ai-chat-mini-card__title">{item.code || item.file_name || item.id}</div>
                <div className="ai-chat-mini-card__body">
                  {item.file_name}{item.file_size ? ` · ${formatBytes(item.file_size)}` : ''}
                </div>
                <div className="ai-chat-mini-card__meta">{item.actor_name || '배우 미상'} · 재생 {item.play_count || 0}회 · 복사 {item.copy_count || 0}회</div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return null
}

function MessageBubble({ message, onAction }) {
  const isUser = message.role === 'user'
  const isLoading = message.status === 'loading'
  const isError = message.status === 'error'

  return (
    <div className={`ai-chat-message-row ${isUser ? 'ai-chat-message-row--user' : 'ai-chat-message-row--assistant'}`}>
      <div className={`ai-chat-message ${isUser ? 'ai-chat-message--user' : 'ai-chat-message--assistant'} ${isError ? 'ai-chat-message--error' : ''}`}>
        <div className="ai-chat-message__content">{message.content}</div>
        {message.toolCall?.name && (
          <div className="ai-chat-message__tool">
            {isLoading ? '도구 실행 중...' : `도구: ${message.toolCall.name}`}
          </div>
        )}
        {!isLoading && !isError && message.data && (
          <ToolResultCard message={message} onAction={onAction} />
        )}
        <div className="ai-chat-message__time">
          {formatDateTime(message.createdAt)}
        </div>
      </div>
    </div>
  )
}

function MessageList({ messages, onAction }) {
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages])

  return (
    <div className="ai-chat-message-list">
      {messages.length === 0 ? (
        <div className="ai-chat-empty-state">
          <div className="ai-chat-empty-state__icon">💬</div>
          <div className="ai-chat-empty-state__title">질문을 입력하면 Actor Picker 기능을 호출합니다.</div>
          <div className="ai-chat-empty-state__desc">
            영상 검색, 배우 검색, 저장소 통계를 자연어로 요청할 수 있습니다.
          </div>
        </div>
      ) : messages.map((message) => (
        <MessageBubble key={message.id} message={message} onAction={onAction} />
      ))}
      <div ref={endRef} />
    </div>
  )
}

function Composer({ onSend, isSending, currentPage, disabled = false, placeholder }) {
  const [draft, setDraft] = useState('')
  const textareaRef = useRef(null)
  const examples = useMemo(() => getExamples(currentPage), [currentPage])

  const submit = async () => {
    const message = draft.trim()
    if (!message || isSending || disabled) return
    const result = await onSend(message)
    if (result?.success) {
      setDraft('')
      textareaRef.current?.focus()
    }
  }

  return (
    <div className="ai-chat-composer">
      <div className="ai-chat-examples">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            className="ai-chat-example-btn"
            onClick={() => setDraft(example)}
            disabled={isSending}
          >
            {example}
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        className="ai-chat-composer__input"
        rows={3}
        maxLength={2000}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
        placeholder={placeholder || '메시지를 입력하세요. Enter 전송 / Shift+Enter 줄바꿈'}
        disabled={disabled}
      />
      <div className="ai-chat-composer__footer">
        <span className="ai-chat-composer__hint">
          {draft.length}/2000
        </span>
        <button
          type="button"
          className="ai-chat-send-btn"
          onClick={submit}
          disabled={disabled || isSending || !draft.trim()}
        >
          {isSending ? '전송 중…' : '전송'}
        </button>
      </div>
    </div>
  )
}

function Header({
  title,
  currentPage,
  onNewChat,
  onOpenFullScreen,
  onClose,
  onClearSessions,
  onSwitchQuick,
  onSwitchConsult,
  entryMode,
  compact = false,
}) {
  const showModeSwitchButtons = Boolean(entryMode)

  return (
    <div className={`ai-chat-header ${compact ? 'ai-chat-header--compact' : ''}`}>
      <div className="ai-chat-header__main">
        <div className="ai-chat-header__title" title={title}>{title}</div>
        <div className="ai-chat-header__subtitle">현재 화면: {getPageLabel(currentPage)}</div>
      </div>
      <div className="ai-chat-header__actions">
        {showModeSwitchButtons && (
          <>
            <button
              type="button"
              className={`ai-chat-header__button ${entryMode === 'quick' ? '' : 'ai-chat-header__button--ghost'}`}
              onClick={onSwitchQuick}
            >
              빠른 작업으로 전환
            </button>
            <button
              type="button"
              className={`ai-chat-header__button ${entryMode === 'consult' ? '' : 'ai-chat-header__button--ghost'}`}
              onClick={onSwitchConsult}
            >
              AI 상담으로 전환
            </button>
          </>
        )}
        <button type="button" className="ai-chat-header__button" onClick={onNewChat}>새 채팅</button>
        {!compact && <button type="button" className="ai-chat-header__button" onClick={onClearSessions}>초기화</button>}
        <button type="button" className="ai-chat-header__button" onClick={onOpenFullScreen}>전체 화면</button>
        <button type="button" className="ai-chat-header__button ai-chat-header__button--ghost" onClick={onClose}>닫기</button>
      </div>
    </div>
  )
}

function ModeSelectionPanel({ onSelectMode }) {
  return (
    <div className="ai-chat-entry-panel">
      <div className="ai-chat-entry-panel__title">Actor Picker AI</div>
      <div className="ai-chat-entry-panel__desc">원하는 방식으로 시작하세요.</div>
      <div className="ai-chat-entry-panel__actions">
        <button
          type="button"
          className="ai-chat-entry-panel__button"
          onClick={() => onSelectMode('quick')}
        >
          <div className="ai-chat-entry-panel__button-title">빠른 작업</div>
          <div className="ai-chat-entry-panel__button-desc">정해진 선택지를 따라 정확하게 실행합니다.</div>
        </button>
        <button
          type="button"
          className="ai-chat-entry-panel__button"
          onClick={() => onSelectMode('consult')}
        >
          <div className="ai-chat-entry-panel__button-title">AI에게 물어보기</div>
          <div className="ai-chat-entry-panel__button-desc">상담하듯 요청하면 필요한 조건을 함께 정리합니다.</div>
        </button>
      </div>
    </div>
  )
}

function SessionList({ sessions, activeSessionId, onSelectSession, onDeleteSession, onNewChat, collapsed, onToggleCollapsed }) {
  return (
    <div className={`ai-chat-session-list ${collapsed ? 'ai-chat-session-list--collapsed' : ''}`}>
      <div className="ai-chat-session-list__top">
        <button type="button" className="ai-chat-session-list__action" onClick={onNewChat}>＋ 새 채팅</button>
        <button type="button" className="ai-chat-session-list__action ai-chat-session-list__action--ghost" onClick={onToggleCollapsed}>
          {collapsed ? '펼치기' : '접기'}
        </button>
      </div>
      <div className="ai-chat-session-list__items">
        {sessions.length === 0 ? (
          <div className="ai-chat-session-list__empty">저장된 대화가 없습니다.</div>
        ) : sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className={`ai-chat-session-item ${activeSessionId === session.id ? 'ai-chat-session-item--active' : ''}`}
            onClick={() => onSelectSession(session.id)}
          >
            <div className="ai-chat-session-item__title" title={session.title}>{session.title}</div>
            <div className="ai-chat-session-item__meta">{formatDateTime(session.updatedAt)}</div>
            <div
              className="ai-chat-session-item__delete"
              onClick={(event) => {
                event.stopPropagation()
                onDeleteSession(session.id)
              }}
              role="button"
              tabIndex={0}
            >
              ×
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function ChatBody({ session, isSending, currentPage, onSend, onAction }) {
  const entryMode = session?.entryMode || null
  const phase = session?.phase || 'mode_selection'
  const composerDisabled = !entryMode || entryMode === 'quick'
  const messages = session?.messages || []
  const shouldShowEntryPanel = !entryMode && messages.length === 0

  return (
    <div className="ai-chat-body">
      <div className="ai-chat-body__context">
        <Tag color="blue">{getPageLabel(currentPage)}</Tag>
        {entryMode && <Tag color={entryMode === 'quick' ? 'green' : 'purple'}>{entryMode === 'quick' ? '빠른 작업' : 'AI 상담'}</Tag>}
        {phase && <Tag color="gold">{phase}</Tag>}
        {session?.activeFilters?.drive && <Tag color="geekblue">{session.activeFilters.drive}</Tag>}
        {Array.isArray(session?.lastResultIds) && session.lastResultIds.length > 0 && (
          <Tag color="cyan">최근 결과 {session.lastResultIds.length}개</Tag>
        )}
      </div>
      {shouldShowEntryPanel && (
        <ModeSelectionPanel
          onSelectMode={(mode) => onAction({ type: 'select_entry_mode', label: mode === 'quick' ? '빠른 작업' : 'AI 상담', payload: { type: 'select_entry_mode', mode } })}
        />
      )}
      <MessageList messages={messages} onAction={onAction} />
      <Composer
        onSend={onSend}
        isSending={isSending}
        currentPage={currentPage}
        disabled={composerDisabled}
        placeholder={!entryMode
          ? '모드를 먼저 선택해 주세요.'
          : entryMode === 'quick'
            ? '빠른 작업 모드는 버튼 선택으로 진행합니다.'
            : '요청을 입력하세요. Enter 전송 / Shift+Enter 줄바꿈'}
      />
    </div>
  )
}

export function AiChatLauncher() {
  const { isDrawerOpen, isFullScreen, openDrawer, closeDrawer } = useAiChat()

  if (isDrawerOpen || isFullScreen) return null

  return (
    <button
      type="button"
      className="ai-chat-launcher"
      onClick={() => (isDrawerOpen ? closeDrawer() : openDrawer())}
      aria-label="AI 챗봇 열기"
      title="AI 챗봇"
    >
      <svg className="ai-chat-launcher__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.5 17.2 4 20v-3.3C2.8 15.2 2 13.7 2 12c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8c-.8 0-1.6-.1-2.4-.3L7.5 17.2Z" fill="currentColor" opacity="0.18" />
        <path d="M7.7 11.2h8.6M7.7 14.2h5.1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M17.2 6.3l.4-1 .4 1 .9.4-.9.4-.4 1-.4-1-.9-.4.9-.4Z" fill="currentColor" opacity="0.95" />
      </svg>
    </button>
  )
}

export function AiChatDrawer() {
  const {
    activeSession,
    isDrawerOpen,
    isFullScreen,
    isSending,
    currentContext,
    openDrawer,
    closeDrawer,
    openFullScreen,
    createSession,
    clearSessions,
    sendMessage,
  } = useAiChat()

  const [drawerWidth, setDrawerWidth] = useState(440)

  useEffect(() => {
    const updateWidth = () => {
      const width = typeof window !== 'undefined' ? window.innerWidth : 1200
      const next = Math.max(360, Math.min(480, Math.floor(width * 0.36)))
      setDrawerWidth(next)
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  const handleNewChat = () => {
    createSession('새 채팅', currentContext.activeFilters)
    openDrawer()
  }

  const switchMode = async (mode) => {
    const hasInProgress = ['collecting_slots', 'confirming', 'executing'].includes(activeSession?.phase)
    if (hasInProgress) {
      const ok = window.confirm('진행 중인 작업이 있습니다. 현재 작업을 초기화하고 모드를 전환할까요?')
      if (!ok) return
    }
    await sendMessage({
      action: {
        type: 'switch_mode',
        label: mode === 'quick' ? '빠른 작업으로 전환' : 'AI 상담으로 전환',
        payload: { type: 'switch_mode', mode },
      },
      context: currentContext,
    })
  }

  return (
    <Drawer
      open={isDrawerOpen && !isFullScreen}
      onClose={closeDrawer}
      width={drawerWidth}
      destroyOnClose={false}
      closable={false}
      mask={false}
      placement="right"
      zIndex={2200}
      className="ai-chat-drawer"
      rootClassName="ai-chat-drawer-root"
      bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column' }}
      headerStyle={{ display: 'none' }}
    >
      <Header
        title={activeSession?.title || 'AI 챗봇'}
        currentPage={currentContext.currentPage}
        onNewChat={handleNewChat}
        onOpenFullScreen={openFullScreen}
        onClose={closeDrawer}
        onClearSessions={clearSessions}
        onSwitchQuick={() => switchMode('quick')}
        onSwitchConsult={() => switchMode('consult')}
        entryMode={activeSession?.entryMode || null}
        compact
      />
      <ChatBody
        session={activeSession}
        isSending={isSending}
        currentPage={currentContext.currentPage}
        onSend={async (message) => sendMessage({ message, context: currentContext })}
        onAction={async (action) => sendMessage({ action, context: currentContext })}
      />
    </Drawer>
  )
}

export function AiChatFullscreen() {
  const {
    sessions,
    activeSession,
    activeSessionId,
    isFullScreen,
    isSending,
    currentContext,
    closeFullScreen,
    createSession,
    deleteSession,
    clearSessions,
    selectSession,
    sendMessage,
  } = useAiChat()

  const [collapsed, setCollapsed] = useState(false)

  if (!isFullScreen) return null

  const handleNewChat = () => {
    createSession('새 채팅', currentContext.activeFilters)
  }

  const switchMode = async (mode) => {
    const hasInProgress = ['collecting_slots', 'confirming', 'executing'].includes(activeSession?.phase)
    if (hasInProgress) {
      const ok = window.confirm('진행 중인 작업이 있습니다. 현재 작업을 초기화하고 모드를 전환할까요?')
      if (!ok) return
    }
    await sendMessage({
      action: {
        type: 'switch_mode',
        label: mode === 'quick' ? '빠른 작업으로 전환' : 'AI 상담으로 전환',
        payload: { type: 'switch_mode', mode },
      },
      context: currentContext,
    })
  }

  return (
    <div className="ai-chat-fullscreen">
      <div className="ai-chat-fullscreen__header">
        <Header
          title="AI 챗봇"
          currentPage={currentContext.currentPage}
          onNewChat={handleNewChat}
          onOpenFullScreen={closeFullScreen}
          onClose={closeFullScreen}
          onClearSessions={clearSessions}
          onSwitchQuick={() => switchMode('quick')}
          onSwitchConsult={() => switchMode('consult')}
          entryMode={activeSession?.entryMode || null}
        />
      </div>
      <div className="ai-chat-fullscreen__content">
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={selectSession}
          onDeleteSession={deleteSession}
          onNewChat={handleNewChat}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
        />
        <div className="ai-chat-fullscreen__conversation">
          <ChatBody
            session={activeSession}
            isSending={isSending}
            currentPage={currentContext.currentPage}
            onSend={async (message) => sendMessage({ message, context: currentContext })}
            onAction={async (action) => sendMessage({ action, context: currentContext })}
          />
        </div>
      </div>
      <button type="button" className="ai-chat-fullscreen__close" onClick={closeFullScreen}>닫기</button>
    </div>
  )
}
