/**
 * src/pages/JellyfinExport/index.jsx
 * Jellyfin 호환 메타데이터 내보내기 페이지
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Modal, Progress, Select, Space, Table, Tag, Typography, message } from 'antd'
import './JellyfinExport.css'

const FILTER_OPTIONS = [
  { value: 'all', label: '전체 작품' },
  { value: 'subtitleAvailable', label: '자막 있음' },
  { value: 'subtitleMissing', label: '자막 없음' },
  { value: 'notAnalyzed', label: '분석 전' },
  { value: 'analyzed', label: '분석 완료' },
  { value: 'stale', label: '재분석 필요' },
  { value: 'nfoMissing', label: 'NFO 없음' },
  { value: 'error', label: '오류' },
]

const NFO_MODE_OPTIONS = [
  { value: 'skip', label: 'skip' },
  { value: 'backup-and-overwrite', label: 'backup-and-overwrite' },
  { value: 'overwrite-generated-only', label: 'overwrite-generated-only' },
]

function formatCount(value) {
  return Number(value || 0).toLocaleString()
}

function statusTag(status, labels, colors) {
  const color = colors[status] || 'default'
  return (
    <Tag color={color} style={{ color: color === 'default' ? '#0f172a' : undefined }}>
      {labels[status] || status || '—'}
    </Tag>
  )
}

function statusBadge(status, labels, classNameMap) {
  const className = classNameMap[status] || classNameMap.default || ''
  return <Tag className={`jellyfin-status-badge ${className}`.trim()}>{labels[status] || status || '—'}</Tag>
}

function buildFilterPredicate(filterKey) {
  return (item) => {
    switch (filterKey) {
      case 'subtitleAvailable': return item.subtitleStatus === 'available'
      case 'subtitleMissing': return item.subtitleStatus === 'missing' || item.subtitleStatus === 'file_missing'
      case 'notAnalyzed': return item.aiSummaryStatus === 'not_analyzed'
      case 'analyzed': return item.aiSummaryStatus === 'generated' || item.aiSummaryStatus === 'approved'
      case 'stale': return item.aiSummaryStatus === 'stale'
      case 'nfoMissing': return !item.nfoExists
      case 'error': return item.subtitleStatus === 'error' || item.videoFileMissing
      default: return true
    }
  }
}

function buildCountLabel(stats, key, fallback = 0) {
  const value = stats?.filterCounts?.[key]
  return `${formatCount(value ?? fallback)}개`
}

export default function JellyfinExportPage() {
  const [items, setItems] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [filterKey, setFilterKey] = useState('all')
  const [nfoMode, setNfoMode] = useState('skip')
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [scanProgress, setScanProgress] = useState(null)
  const [exportProgress, setExportProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewItems, setPreviewItems] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [listResult, statsResult] = await Promise.all([
        window.api.listJellyfinExportItems(),
        window.api.getJellyfinExportStats(),
      ])
      setItems(Array.isArray(listResult?.items) ? listResult.items : [])
      setStats(statsResult || listResult?.stats || null)
    } catch (error) {
      message.error(`Jellyfin 목록 로드 실패: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      load()
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const offScan = window.api.onJellyfinScanProgress((payload) => {
      setScanProgress(payload)
    })
    const offExport = window.api.onJellyfinExportProgress((payload) => {
      setExportProgress(payload)
    })
    return () => {
      offScan?.()
      offExport?.()
    }
  }, [])

  const visibleItems = useMemo(() => {
    const predicate = buildFilterPredicate(filterKey)
    return items.filter(predicate)
  }, [items, filterKey])

  const selectedItems = useMemo(() => {
    const keySet = new Set(selectedRowKeys.map((value) => Number(value)))
    return items.filter((item) => keySet.has(Number(item.id)))
  }, [items, selectedRowKeys])

  const exportableCount = useMemo(
    () => items.filter((item) => item.exportEligible).length,
    [items],
  )

  const handleScan = useCallback(async () => {
    setScanLoading(true)
    setScanProgress(null)
    try {
      const response = await window.api.scanJellyfinSubtitles()
      setResult(response)
      message.success(`자막 검사 완료 · ${formatCount(response?.summary?.updatedCount || 0)}개 갱신`)
      await load()
    } catch (error) {
      message.error(`자막 검사 실패: ${error.message}`)
    } finally {
      setScanLoading(false)
      setScanProgress(null)
    }
  }, [load])

  const runExport = useCallback(async (mode, payload = {}) => {
    setExportLoading(true)
    setExportProgress(null)
    try {
      const response = payload.itemIds
        ? await window.api.exportSelectedJellyfinNfo({ itemIds: payload.itemIds, nfoMode: mode })
        : payload.kind === 'test'
          ? await window.api.exportTestJellyfinNfo({ nfoMode: mode })
          : await window.api.exportAllJellyfinNfo({ nfoMode: mode })

      setResult(response)
      message.success(`NFO 생성 완료 · 성공 ${formatCount(response?.summary?.created || 0)}개`)
      await load()
    } catch (error) {
      message.error(`NFO 생성 실패: ${error.message}`)
    } finally {
      setExportLoading(false)
      setExportProgress(null)
    }
  }, [load])

  const handleExportSelected = useCallback(() => {
    if (selectedItems.length === 0) {
      message.info('먼저 작품을 선택해 주세요.')
      return
    }

    Modal.confirm({
      title: '선택 작품 NFO 생성',
      content: `${selectedItems.length}개 작품의 NFO를 생성합니다.`,
      okText: '생성',
      cancelText: '취소',
      onOk: () => runExport(nfoMode, { itemIds: selectedItems.map((item) => item.id) }),
    })
  }, [nfoMode, runExport, selectedItems])

  const handleExportAll = useCallback(() => {
    Modal.confirm({
      title: '전체 NFO 생성',
      content: `대상 ${formatCount(exportableCount)}개 작품의 NFO를 생성합니다.`,
      okText: '생성',
      cancelText: '취소',
      onOk: () => runExport(nfoMode, { kind: 'all' }),
    })
  }, [exportableCount, nfoMode, runExport])

  const handleExportTest = useCallback(async () => {
    const preview = items.filter((item) => item.exportEligible).slice(0, 10)
    setPreviewItems(preview)
    setPreviewOpen(true)
  }, [items])

  const handleConfirmTest = useCallback(() => {
    setPreviewOpen(false)
    runExport(nfoMode, { kind: 'test' })
  }, [nfoMode, runExport])

  const summaryCards = useMemo(() => {
    const summary = stats || {}
    return [
      { label: '전체 작품', value: formatCount(summary.totalVideos) },
      { label: '영상 파일 존재', value: formatCount(summary.videoFileExists) },
      { label: '영상 파일 없음', value: formatCount(summary.videoFileMissing) },
      { label: '자막 있음', value: formatCount(summary.subtitleAvailable) },
      { label: '자막 없음', value: formatCount(summary.subtitleMissing) },
      { label: '대표 자막 선택 완료', value: formatCount(summary.primarySubtitleSelected) },
      { label: '검사 오류', value: formatCount(summary.scanErrors) },
      { label: 'AI 분석 전', value: formatCount(summary.aiNotAnalyzed) },
      { label: 'AI 분석 완료', value: formatCount(summary.aiAnalyzed) },
      { label: '재분석 필요', value: formatCount(summary.aiStale) },
      { label: 'NFO 존재', value: formatCount(summary.nfoExists) },
      { label: 'NFO 없음', value: formatCount(summary.nfoMissing) },
    ]
  }, [stats])

  const columns = useMemo(() => [
    {
      title: '품번',
      dataIndex: 'code',
      width: 110,
      render: (value, record) => value || record.title || '—',
    },
    {
      title: '파일명',
      dataIndex: 'fileName',
      width: 260,
      ellipsis: true,
    },
    {
      title: '배우',
      dataIndex: 'actorNameText',
      width: 220,
      ellipsis: true,
      render: (value, record) => value || record.actorNameText || '—',
    },
    {
      title: '영상 상태',
      dataIndex: 'videoFileExists',
      width: 110,
      render: (value) => statusTag(
        value ? 'exists' : 'missing',
        { exists: '존재', missing: '없음' },
        { exists: 'green', missing: 'red' },
      ),
    },
    {
      title: '자막 상태',
      dataIndex: 'subtitleStatus',
      width: 130,
      render: (value) => statusBadge(
        value,
        {
          available: '있음',
          missing: '없음',
          file_missing: '파일 없음',
          error: '오류',
          unknown: '미확인',
        },
        {
          available: 'jellyfin-status-badge--good',
          missing: 'jellyfin-status-badge--neutral',
          file_missing: 'jellyfin-status-badge--warning',
          error: 'jellyfin-status-badge--danger',
          unknown: 'jellyfin-status-badge--neutral',
        },
      ),
    },
    {
      title: '대표 자막 파일명',
      dataIndex: 'primarySubtitleFileName',
      width: 210,
      ellipsis: true,
      render: (value) => value || '—',
    },
    {
      title: 'AI 요약 상태',
      dataIndex: 'aiSummaryStatus',
      width: 130,
      render: (value) => statusBadge(
        value,
        {
          not_analyzed: '분석 전',
          pending: '대기',
          generated: '생성됨',
          approved: '승인됨',
          failed: '실패',
          stale: '재분석 필요',
          not_available: '자막 없음',
        },
        {
          not_analyzed: 'jellyfin-status-badge--neutral',
          pending: 'jellyfin-status-badge--info',
          generated: 'jellyfin-status-badge--good',
          approved: 'jellyfin-status-badge--success',
          failed: 'jellyfin-status-badge--danger',
          stale: 'jellyfin-status-badge--warning',
          not_available: 'jellyfin-status-badge--neutral',
        },
      ),
    },
    {
      title: 'NFO 존재',
      dataIndex: 'nfoExists',
      width: 100,
      render: (value) => statusTag(value ? 'yes' : 'no', { yes: '있음', no: '없음' }, { yes: 'green', no: 'red' }),
    },
    {
      title: '작업 상태',
      dataIndex: 'exportExclusionReasons',
      width: 180,
      render: (_value, record) => (
        <Space wrap size={4}>
          {!record.exportEligible && record.exportExclusionReasons.map((reason) => (
            <Tag key={reason} color="red">{reason}</Tag>
          ))}
          {record.exportEligible && <Tag color="green">내보내기 가능</Tag>}
          {!record.hasActorLinks && <Tag color="orange">배우 연결 없음</Tag>}
        </Space>
      ),
    },
    {
      title: '폴더',
      dataIndex: 'folderPath',
      ellipsis: true,
      render: (value) => value || '—',
    },
  ], [])

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  }

  return (
    <div className="jellyfin-page">
      <div className="jellyfin-hero">
        <div>
          <div className="jellyfin-hero__eyebrow">Jellyfin Metadata Export</div>
          <h2 className="jellyfin-hero__title">Jellyfin 메타데이터</h2>
          <p className="jellyfin-hero__desc">
            영상 파일과 같은 폴더에 Jellyfin 호환 `.nfo`를 생성합니다. 자막은 실제 파일 시스템을 검사해 대표 자막을 선택하고, 배우·품번·기존 작품 메타데이터를 함께 반영합니다.
          </p>
        </div>

        <div className="jellyfin-hero__actions">
          <Button type="primary" onClick={handleScan} loading={scanLoading}>
            자막 상태 다시 검사
          </Button>
          <Button onClick={handleExportSelected} disabled={selectedItems.length === 0} loading={exportLoading}>
            선택 작품 NFO 생성
          </Button>
          <Button onClick={handleExportTest} loading={exportLoading}>
            테스트 10개 NFO 생성
          </Button>
          <Button danger onClick={handleExportAll} loading={exportLoading}>
            전체 NFO 생성
          </Button>
        </div>
      </div>

      <div className="jellyfin-toolbar">
        <Space wrap align="center" size={12}>
          <span className="jellyfin-toolbar__label">필터</span>
          <Select
            value={filterKey}
            onChange={setFilterKey}
            options={FILTER_OPTIONS.map((option) => ({
              value: option.value,
              label: `${option.label} (${buildCountLabel(stats, option.value === 'all' ? 'all' : option.value)})`,
            }))}
            style={{ minWidth: 240 }}
          />
          <span className="jellyfin-toolbar__label">기존 NFO 정책</span>
          <Select
            value={nfoMode}
            onChange={setNfoMode}
            options={NFO_MODE_OPTIONS}
            style={{ minWidth: 260 }}
          />
          <span className="jellyfin-toolbar__label">선택 {selectedItems.length}개</span>
          <span className="jellyfin-toolbar__label">내보내기 대상 {exportableCount}개</span>
        </Space>
      </div>

      {scanProgress && (
        <Card className="jellyfin-progress-card" size="small">
          <div className="jellyfin-progress-card__title">자막 검사 진행</div>
          <Progress percent={Math.round(((scanProgress.processed || 0) / Math.max(scanProgress.total || 1, 1)) * 100)} status="active" />
          <div className="jellyfin-progress-card__desc">
            {scanProgress.current?.fileName || '처리 중'} · {scanProgress.processed || 0}/{scanProgress.total || 0}
          </div>
        </Card>
      )}

      {exportProgress && (
        <Card className="jellyfin-progress-card" size="small">
          <div className="jellyfin-progress-card__title">NFO 생성 진행</div>
          <Progress percent={Math.round(((exportProgress.processed || 0) / Math.max(exportProgress.total || 1, 1)) * 100)} status="active" />
          <div className="jellyfin-progress-card__desc">
            {exportProgress.current?.title || exportProgress.current?.fileName || '처리 중'} · {exportProgress.processed || 0}/{exportProgress.total || 0}
          </div>
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
                  대상 {formatCount(result.summary.totalTargets ?? result.summary.totalVideos ?? 0)}개 · 생성 {formatCount(result.summary.created ?? 0)}개 · 건너뜀 {formatCount(result.summary.skipped ?? 0)}개 · 오류 {formatCount(result.summary.errors ?? 0)}개
                </div>
              )}
              {Array.isArray(result.summary?.errorItems) && result.summary.errorItems.length > 0 && (
                <div className="jellyfin-result__errors">
                  오류 예시: {result.summary.errorItems.slice(0, 3).map((item) => item.title || item.fileName).join(', ')}
                </div>
              )}
            </div>
          )}
          style={{ marginBottom: 16 }}
        />
      )}

      <div className="jellyfin-cards">
        {summaryCards.map((card) => (
          <Card key={card.label} className="jellyfin-stat-card" size="small">
            <div className="jellyfin-stat-card__label">{card.label}</div>
            <div className="jellyfin-stat-card__value">{card.value}</div>
          </Card>
        ))}
      </div>

      <Card className="jellyfin-table-card" size="small">
        <Table
          rowKey="id"
          loading={loading}
          rowSelection={rowSelection}
          dataSource={visibleItems}
          columns={columns}
          pagination={{ pageSize: 30, showSizeChanger: true, pageSizeOptions: [20, 30, 50, 100] }}
          scroll={{ x: 1680, y: 640 }}
          size="middle"
        />
      </Card>

      <Modal
        open={previewOpen}
        title="테스트 10개 NFO 생성 미리보기"
        onCancel={() => setPreviewOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setPreviewOpen(false)}>취소</Button>,
          <Button key="confirm" type="primary" onClick={handleConfirmTest}>생성</Button>,
        ]}
        width={1080}
        centered
      >
        <Typography.Paragraph>
          아래 10개 작품이 실제 NFO 생성 대상입니다. 기존 NFO 정책은 현재 선택값인 <strong>{nfoMode}</strong>를 따릅니다.
        </Typography.Paragraph>
        <div className="jellyfin-preview-list">
          {previewItems.map((item) => (
            <div key={item.id} className="jellyfin-preview-item">
              <div className="jellyfin-preview-item__left">
                <strong>{item.title}</strong>
                <span>{item.fileName}</span>
              </div>
              <div className="jellyfin-preview-item__right">
                <Tag color={item.subtitleStatus === 'available' ? 'green' : 'gold'}>{item.subtitleStatus}</Tag>
                <Tag color={item.hasActorLinks ? 'blue' : 'orange'}>{item.actorNameText || '배우 없음'}</Tag>
              </div>
            </div>
          ))}
          {previewItems.length === 0 && <div className="jellyfin-preview-empty">내보낼 대상이 없습니다.</div>}
        </div>
      </Modal>
    </div>
  )
}