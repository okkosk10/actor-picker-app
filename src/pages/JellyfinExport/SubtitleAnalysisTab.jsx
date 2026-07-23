import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Input, Modal, Progress, Select, Space, Table, Tag, message } from 'antd'

const FILTER_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'subtitleAvailable', label: '자막 있음' },
  { value: 'notAnalyzed', label: '분석 전' },
  { value: 'generated', label: '생성됨' },
  { value: 'approved', label: '승인됨' },
  { value: 'failed', label: '실패' },
  { value: 'stale', label: '재분석 필요' },
]

function formatCount(value) {
  return Number(value || 0).toLocaleString()
}

function formatConfidence(value) {
  const raw = Number(value || 0)
  return `${Math.max(0, Math.min(1, raw)).toFixed(2)}`
}

function statusTag(status, labels, colors) {
  return <Tag color={colors[status] || 'default'}>{labels[status] || status || '—'}</Tag>
}

function parseList(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function buildAnalysisCounts(items) {
  const counts = { all: items.length, subtitleAvailable: 0, notAnalyzed: 0, generated: 0, approved: 0, failed: 0, stale: 0 }
  for (const item of items) {
    if (item.subtitleStatus === 'available') counts.subtitleAvailable += 1
    const status = String(item.aiSummaryStatus || 'not_analyzed')
    if (status === 'not_analyzed') counts.notAnalyzed += 1
    else if (status === 'generated') counts.generated += 1
    else if (status === 'approved') counts.approved += 1
    else if (status === 'failed') counts.failed += 1
    else if (status === 'stale') counts.stale += 1
  }
  return counts
}

function buildAnalysisFilterPredicate(filterKey) {
  return (item) => {
    switch (filterKey) {
      case 'subtitleAvailable': return item.subtitleStatus === 'available'
      case 'notAnalyzed': return item.aiSummaryStatus === 'not_analyzed'
      case 'generated': return item.aiSummaryStatus === 'generated'
      case 'approved': return item.aiSummaryStatus === 'approved'
      case 'failed': return item.aiSummaryStatus === 'failed'
      case 'stale': return item.aiSummaryStatus === 'stale'
      default: return true
    }
  }
}

function AnalysisEditModal({ open, item, onCancel, onSave, onSaveAndApprove, saving }) {
  const [draft, setDraft] = useState(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!item) {
        setDraft(null)
        return
      }

      setDraft({
        outline: item.aiOutline || '',
        plot: item.aiPlot || '',
        opening: item.aiStoryStructure?.opening || '',
        middle: item.aiStoryStructure?.middle || '',
        ending: item.aiStoryStructure?.ending || '',
        tagsText: parseList(item.aiTags).join(', '),
        relationshipText: parseList(item.aiRelationship).join(', '),
        toneText: parseList(item.aiTone).join(', '),
        warningsText: parseList(item.aiWarnings).join(', '),
        confidence: Number(item.aiConfidence || 0) || 0,
      })
    }, 0)

    return () => clearTimeout(timer)
  }, [item])

  const updateField = useCallback((field, value) => {
    setDraft((prev) => ({ ...(prev || {}), [field]: value }))
  }, [])

  const handleSave = useCallback((approve) => {
    if (!item || !draft) return
    const payload = {
      videoId: item.id,
      outline: draft.outline,
      plot: draft.plot,
      story_structure: {
        opening: draft.opening,
        middle: draft.middle,
        ending: draft.ending,
      },
      tags: draft.tagsText.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
      relationship: draft.relationshipText.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
      tone: draft.toneText.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
      warnings: draft.warningsText.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
      confidence: Number(draft.confidence) || 0,
      approved: approve,
    }

    if (approve) onSaveAndApprove?.(payload)
    else onSave?.(payload)
  }, [draft, item, onSave, onSaveAndApprove])

  return (
    <Modal
      open={open}
      title={item ? `결과 검수 · ${item.code || item.fileName || item.id}` : '결과 검수'}
      onCancel={onCancel}
      width={1120}
      centered
      footer={[
        <Button key="cancel" onClick={onCancel}>닫기</Button>,
        <Button key="approve" onClick={() => handleSave(true)} loading={saving}>저장 후 승인</Button>,
        <Button key="save" type="primary" onClick={() => handleSave(false)} loading={saving}>저장</Button>,
      ]}
    >
      {draft ? (
        <div className="jellyfin-analysis-modal">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div className="jellyfin-analysis-modal__grid">
              <div>
                <div className="jellyfin-analysis-modal__label">한 줄 설명</div>
                <Input value={draft.outline} onChange={(event) => updateField('outline', event.target.value)} />
              </div>
              <div>
                <div className="jellyfin-analysis-modal__label">신뢰도</div>
                <Input value={draft.confidence} onChange={(event) => updateField('confidence', event.target.value)} />
              </div>
            </div>

            <div>
              <div className="jellyfin-analysis-modal__label">작품 설명</div>
              <Input.TextArea rows={4} value={draft.plot} onChange={(event) => updateField('plot', event.target.value)} />
            </div>

            <div className="jellyfin-analysis-modal__grid jellyfin-analysis-modal__grid--3">
              <div>
                <div className="jellyfin-analysis-modal__label">초반 구성</div>
                <Input.TextArea rows={4} value={draft.opening} onChange={(event) => updateField('opening', event.target.value)} />
              </div>
              <div>
                <div className="jellyfin-analysis-modal__label">중반 구성</div>
                <Input.TextArea rows={4} value={draft.middle} onChange={(event) => updateField('middle', event.target.value)} />
              </div>
              <div>
                <div className="jellyfin-analysis-modal__label">후반 구성</div>
                <Input.TextArea rows={4} value={draft.ending} onChange={(event) => updateField('ending', event.target.value)} />
              </div>
            </div>

            <div className="jellyfin-analysis-modal__grid jellyfin-analysis-modal__grid--2">
              <div>
                <div className="jellyfin-analysis-modal__label">AI 태그</div>
                <Input.TextArea rows={3} value={draft.tagsText} onChange={(event) => updateField('tagsText', event.target.value)} />
              </div>
              <div>
                <div className="jellyfin-analysis-modal__label">관계</div>
                <Input.TextArea rows={3} value={draft.relationshipText} onChange={(event) => updateField('relationshipText', event.target.value)} />
              </div>
            </div>

            <div className="jellyfin-analysis-modal__grid jellyfin-analysis-modal__grid--2">
              <div>
                <div className="jellyfin-analysis-modal__label">분위기</div>
                <Input.TextArea rows={3} value={draft.toneText} onChange={(event) => updateField('toneText', event.target.value)} />
              </div>
              <div>
                <div className="jellyfin-analysis-modal__label">경고</div>
                <Input.TextArea rows={3} value={draft.warningsText} onChange={(event) => updateField('warningsText', event.target.value)} />
              </div>
            </div>
          </Space>
        </div>
      ) : null}
    </Modal>
  )
}

export default function SubtitleAnalysisTab({ items, onReload }) {
  const [loading, setLoading] = useState(false)
  const [filterKey, setFilterKey] = useState('all')
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [analysisProgress, setAnalysisProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [analysisStats, setAnalysisStats] = useState(null)
  const [editingItem, setEditingItem] = useState(null)
  const [saving, setSaving] = useState(false)
  const [currentRequestId, setCurrentRequestId] = useState('')

  useEffect(() => {
    let mounted = true
    window.api.getJellyfinAnalysisStats?.().then((response) => {
      if (mounted && response?.success) setAnalysisStats(response.stats || null)
    }).catch(() => {})
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const off = window.api.onJellyfinAnalysisProgress?.((payload) => {
      setAnalysisProgress(payload)
    })
    return () => off?.()
  }, [])

  const counts = useMemo(() => ({
    ...buildAnalysisCounts(items || []),
    ...(analysisStats || {}),
    all: (items || []).length,
  }), [analysisStats, items])
  const visibleItems = useMemo(() => (items || []).filter(buildAnalysisFilterPredicate(filterKey)), [items, filterKey])
  const selectedItems = useMemo(() => {
    const keySet = new Set(selectedRowKeys.map((value) => Number(value)))
    return (items || []).filter((item) => keySet.has(Number(item.id)))
  }, [items, selectedRowKeys])

  const refreshAfterAction = useCallback(async () => {
    await onReload?.()
    const response = await window.api.getJellyfinAnalysisStats?.()
    if (response?.success) setAnalysisStats(response.stats || null)
  }, [onReload])

  const startAnalyze = useCallback(async (force = false, targetItems = selectedItems) => {
    if (!targetItems.length) {
      message.info('먼저 작품을 선택해 주세요.')
      return
    }

    const requestId = `analysis-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setCurrentRequestId(requestId)
    setLoading(true)
    setAnalysisProgress(null)
    try {
      const response = await window.api.analyzeSelectedJellyfinMetadata({
        requestId,
        videoIds: targetItems.map((item) => item.id),
        force,
      })
      setResult(response)
      await refreshAfterAction()
      message.success('분석 작업이 완료되었습니다.')
    } catch (error) {
      message.error(`분석 실패: ${error.message}`)
    } finally {
      setLoading(false)
      setCurrentRequestId('')
    }
  }, [refreshAfterAction, selectedItems])

  const startTestAnalyze = useCallback(async () => {
    const requestId = `analysis-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setCurrentRequestId(requestId)
    setLoading(true)
    setAnalysisProgress(null)
    try {
      const response = await window.api.analyzeTestJellyfinMetadata({ requestId })
      setResult(response)
      await refreshAfterAction()
      message.success('테스트 3개 분석이 완료되었습니다.')
    } catch (error) {
      message.error(`분석 실패: ${error.message}`)
    } finally {
      setLoading(false)
      setCurrentRequestId('')
    }
  }, [refreshAfterAction])

  const cancelAnalyze = useCallback(async () => {
    if (!currentRequestId) {
      message.info('실행 중인 분석이 없습니다.')
      return
    }
    await window.api.cancelJellyfinAnalysis({ requestId: currentRequestId })
    setLoading(false)
    setCurrentRequestId('')
  }, [currentRequestId])

  const openReview = useCallback(async (item) => {
    const target = item || selectedItems[0]
    if (!target) {
      message.info('먼저 작품을 하나 선택해 주세요.')
      return
    }
    setEditingItem(null)
    const response = await window.api.getJellyfinAnalysis({ videoId: target.id })
    if (!response?.success) {
      message.error(response?.error || '분석 결과를 불러오지 못했습니다.')
      return
    }
    setEditingItem(response.record)
  }, [selectedItems])

  const saveAnalysis = useCallback(async (payload, approve = false) => {
    setSaving(true)
    try {
      const response = await window.api.updateJellyfinAnalysis({ ...payload, approved: approve })
      if (response?.success === false) {
        message.error(response.error || '저장 실패')
      } else {
        if (approve) {
          await window.api.exportSelectedJellyfinNfo({ itemIds: [payload.videoId], nfoMode: 'backup-and-overwrite' })
        }
        message.success(approve ? '저장 후 승인 완료' : '저장 완료')
        setEditingItem(null)
        await refreshAfterAction()
      }
    } catch (error) {
      message.error(`저장 실패: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }, [refreshAfterAction])

  const approveSelected = useCallback(async () => {
    if (!selectedItems.length) return
    setSaving(true)
    try {
      for (const item of selectedItems) {
        await window.api.approveJellyfinAnalysis({ videoId: item.id })
      }
      await window.api.exportSelectedJellyfinNfo({
        itemIds: selectedItems.map((item) => item.id),
        nfoMode: 'backup-and-overwrite',
      })
      await refreshAfterAction()
      message.success('선택 작품을 승인했습니다.')
    } finally {
      setSaving(false)
    }
  }, [refreshAfterAction, selectedItems])

  const unapproveSelected = useCallback(async () => {
    if (!selectedItems.length) return
    setSaving(true)
    try {
      for (const item of selectedItems) {
        await window.api.unapproveJellyfinAnalysis({ videoId: item.id })
      }
      await refreshAfterAction()
      message.success('선택 작품의 승인을 취소했습니다.')
    } finally {
      setSaving(false)
    }
  }, [refreshAfterAction, selectedItems])

  const regenerateSelectedNfo = useCallback(async () => {
    if (!selectedItems.length) return
    await window.api.exportSelectedJellyfinNfo({ itemIds: selectedItems.map((item) => item.id), nfoMode: 'backup-and-overwrite' })
    message.success('선택 작품 NFO 다시 생성 요청을 보냈습니다.')
  }, [selectedItems])

  const columns = useMemo(() => [
    {
      title: '품번',
      dataIndex: 'code',
      width: 110,
      render: (value, record) => value || record.title || '—',
    },
    {
      title: '배우',
      dataIndex: 'actorNameText',
      width: 210,
      ellipsis: true,
      render: (value) => value || '—',
    },
    {
      title: '대표 자막 파일명',
      dataIndex: 'primarySubtitleFileName',
      width: 220,
      ellipsis: true,
      render: (value) => value || '—',
    },
    {
      title: '자막 상태',
      dataIndex: 'subtitleStatus',
      width: 120,
      render: (value) => statusTag(
        value,
        { available: '있음', missing: '없음', file_missing: '파일 없음', error: '오류', unknown: '미확인' },
        { available: 'green', missing: 'default', file_missing: 'gold', error: 'red', unknown: 'default' },
      ),
    },
    {
      title: 'AI 분석 상태',
      dataIndex: 'aiSummaryStatus',
      width: 120,
      render: (value) => statusTag(
        value,
        { not_analyzed: '분석 전', pending: '대기', generated: '생성됨', approved: '승인됨', failed: '실패', stale: '재분석 필요', not_available: '자막 없음' },
        { not_analyzed: 'default', pending: 'blue', generated: 'green', approved: 'cyan', failed: 'red', stale: 'gold', not_available: 'default' },
      ),
    },
    {
      title: '한 줄 설명',
      dataIndex: 'aiOutline',
      ellipsis: true,
      render: (value) => value || '—',
    },
    {
      title: '신뢰도',
      dataIndex: 'aiConfidence',
      width: 88,
      render: (value) => formatConfidence(value),
    },
    {
      title: '마지막 분석일',
      dataIndex: 'aiSummaryUpdatedAt',
      width: 150,
      render: (value) => value || '—',
    },
    {
      title: '오류',
      dataIndex: 'aiError',
      width: 160,
      ellipsis: true,
      render: (value) => value || '—',
    },
  ], [])

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  }

  return (
    <div className="jellyfin-analysis-tab">
      {analysisProgress && (
        <Card className="jellyfin-progress-card" size="small">
          <div className="jellyfin-progress-card__title">AI 분석 진행</div>
          <Progress percent={Math.round(((analysisProgress.chunkIndex || 0) / Math.max(analysisProgress.chunkCount || 1, 1)) * 100)} status="active" />
          <div className="jellyfin-progress-card__desc">{analysisProgress.message || '처리 중'}</div>
        </Card>
      )}

      {result && (
        <Alert
          type={result.success === false ? 'error' : 'success'}
          showIcon
          closable
          onClose={() => setResult(null)}
          message={result.success === false ? '작업 실패' : '작업 완료'}
          description={(
            <div className="jellyfin-result">
              {result.summary && (
                <div className="jellyfin-result__summary">
                  대상 {formatCount(result.summary.totalTargets || 0)}개 · 생성 {formatCount(result.summary.generated || 0)}개 · 실패 {formatCount(result.summary.failed || 0)}개 · 취소 {formatCount(result.summary.cancelled || 0)}개
                </div>
              )}
            </div>
          )}
          style={{ marginBottom: 16 }}
        />
      )}

      <div className="jellyfin-toolbar">
        <Space wrap align="center" size={12}>
          <span className="jellyfin-toolbar__label">필터</span>
          <Select
            value={filterKey}
            onChange={setFilterKey}
            options={FILTER_OPTIONS.map((option) => ({
              value: option.value,
              label: `${option.label} (${formatCount(counts[option.value] || 0)})`,
            }))}
            style={{ minWidth: 240 }}
          />
          <span className="jellyfin-toolbar__label">선택 {selectedItems.length}개</span>
        </Space>
      </div>

      <div className="jellyfin-analysis-actions">
        <Button type="primary" onClick={() => startAnalyze(false)} loading={loading} disabled={selectedItems.length === 0}>선택 작품 분석</Button>
        <Button onClick={startTestAnalyze} loading={loading}>테스트 3개 분석</Button>
        <Button onClick={() => startAnalyze(true)} loading={loading} disabled={selectedItems.length === 0}>선택 작품 강제 재분석</Button>
        <Button onClick={cancelAnalyze} disabled={!currentRequestId}>분석 취소</Button>
        <Button onClick={() => openReview(selectedItems[0])} disabled={selectedItems.length === 0}>결과 검수</Button>
        <Button onClick={approveSelected} disabled={selectedItems.length === 0} loading={saving}>승인</Button>
        <Button onClick={unapproveSelected} disabled={selectedItems.length === 0} loading={saving}>승인 취소</Button>
        <Button onClick={regenerateSelectedNfo} disabled={selectedItems.length === 0}>선택 작품 NFO 다시 생성</Button>
      </div>

      <Card className="jellyfin-table-card" size="small">
        <Table
          rowKey="id"
          rowSelection={rowSelection}
          dataSource={visibleItems}
          columns={columns}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 30, 50] }}
          scroll={{ x: 1380, y: 620 }}
          size="middle"
        />
      </Card>

      <AnalysisEditModal
        open={Boolean(editingItem)}
        item={editingItem}
        onCancel={() => setEditingItem(null)}
        onSave={(payload) => saveAnalysis(payload, false)}
        onSaveAndApprove={(payload) => saveAnalysis(payload, true)}
        saving={saving}
      />
    </div>
  )
}