import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Progress, Select, Space, Table, Tag, Typography, message } from 'antd'

const STATUS_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'not_synced', label: '미동기화' },
  { value: 'synced', label: '동기화 완료' },
  { value: 'changed', label: '변경됨' },
  { value: 'needs_review', label: '매칭 필요' },
  { value: 'not_found', label: '찾을 수 없음' },
  { value: 'failed', label: '실패' },
  { value: 'image_missing', label: '이미지 없음' },
]

function statusColor(status) {
  if (status === 'synced') return 'green'
  if (status === 'changed') return 'gold'
  if (status === 'needs_review') return 'orange'
  if (status === 'failed' || status === 'not_found') return 'red'
  if (status === 'image_missing') return 'cyan'
  if (status === 'pending') return 'blue'
  return 'default'
}

function shortPersonId(value) {
  const text = String(value || '').trim()
  if (!text) return '—'
  if (text.length <= 12) return text
  return `${text.slice(0, 6)}...${text.slice(-4)}`
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim())
}

function isJellyfinUserId(value) {
  const text = String(value || '').trim()
  if (!text) return true
  const isHex32 = /^[0-9a-f]{32}$/i.test(text)
  return isUuid(text) || isHex32
}

export default function JellyfinActorSyncTab() {
  const [form] = Form.useForm()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [activeRequestId, setActiveRequestId] = useState('')
  const [matchModalOpen, setMatchModalOpen] = useState(false)
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchActor, setMatchActor] = useState(null)
  const [matchResult, setMatchResult] = useState(null)
  const [resolvedUserName, setResolvedUserName] = useState('')

  const loadSettings = useCallback(async () => {
    const settings = await window.api.getJellyfinSyncSettings()
    setResolvedUserName('')
    form.setFieldsValue({
      serverUrl: settings.serverUrl || '',
      apiKey: '',
      userId: settings.userId || '',
      overwriteOverview: settings.overwriteOverview !== false,
      replacePrimaryImage: settings.replacePrimaryImage !== false,
      forceNameUpdate: Boolean(settings.forceNameUpdate),
      includeArchived: Boolean(settings.includeArchived),
    })
  }, [form])

  const loadItems = useCallback(async (options = {}) => {
    setLoading(true)
    try {
      const response = await window.api.listJellyfinActorSyncItems({
        status: filterStatus,
        query,
        refreshChanged: options.refreshChanged === true,
      })
      setItems(Array.isArray(response?.items) ? response.items : [])
    } catch (error) {
      message.error(`배우 동기화 목록 조회 실패: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }, [filterStatus, query])

  useEffect(() => {
    loadSettings().catch((error) => {
      message.error(`Jellyfin 설정 로드 실패: ${error.message}`)
    })
    const timer = setTimeout(() => {
      loadItems({ refreshChanged: true })
    }, 0)
    return () => clearTimeout(timer)
  }, [loadItems, loadSettings])

  useEffect(() => {
    const off = window.api.onJellyfinActorSyncProgress((payload) => {
      if (activeRequestId && payload.requestId && payload.requestId !== activeRequestId) return
      setProgress(payload)
    })
    return () => off?.()
  }, [activeRequestId])

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => {
      const values = [item.name, item.aliases, item.jellyfin_matched_name, item.jellyfin_person_id]
      return values.some((value) => String(value || '').toLowerCase().includes(q))
    })
  }, [items, query])

  const selectedItems = useMemo(() => {
    const keySet = new Set(selectedRowKeys.map((value) => Number(value)))
    return visibleItems.filter((item) => keySet.has(Number(item.id)))
  }, [selectedRowKeys, visibleItems])

  const saveSettings = useCallback(async () => {
    const values = await form.validateFields()
    setSavingSettings(true)
    try {
      const payload = {
        serverUrl: values.serverUrl,
        userId: values.userId,
        overwriteOverview: values.overwriteOverview,
        replacePrimaryImage: values.replacePrimaryImage,
        forceNameUpdate: values.forceNameUpdate,
        includeArchived: values.includeArchived,
      }
      if (values.apiKey) payload.apiKey = values.apiKey

      await window.api.setJellyfinSyncSettings(payload)
      form.setFieldValue('apiKey', '')
      message.success('Jellyfin 설정이 저장되었습니다.')
    } catch (error) {
      message.error(`설정 저장 실패: ${error.message}`)
    } finally {
      setSavingSettings(false)
    }
  }, [form])

  const testConnection = useCallback(async () => {
    const values = await form.validateFields(['serverUrl'])
    const payload = {
      serverUrl: values.serverUrl,
      userId: form.getFieldValue('userId') || '',
    }
    const apiKey = form.getFieldValue('apiKey')
    if (apiKey) payload.apiKey = apiKey

    try {
      const result = await window.api.testJellyfinConnection(payload)
      message.success(`연결 성공: ${result.serverName || 'Jellyfin'} (${result.version || 'unknown'})`)
      if (result.userId) form.setFieldValue('userId', result.userId)
      setResolvedUserName(String(result.userName || '').trim())
    } catch (error) {
      message.error(`연결 실패: ${error.message}`)
      setResolvedUserName('')
    }
  }, [form])

  const runSync = useCallback(async (kind, payload = {}) => {
    setBusy(true)
    setProgress(null)
    try {
      let response
      if (kind === 'test') response = await window.api.syncTestJellyfinActor(payload)
      else if (kind === 'single') response = await window.api.syncJellyfinActor(payload)
      else if (kind === 'selected') response = await window.api.syncSelectedJellyfinActors(payload)
      else if (kind === 'unsynced') response = await window.api.syncUnsyncedJellyfinActors(payload)
      else if (kind === 'changed') response = await window.api.syncChangedJellyfinActors(payload)
      else if (kind === 'force') response = await window.api.forceSyncJellyfinActors(payload)
      else return

      if (response?.requestId) setActiveRequestId(response.requestId)
      if (response?.success === false && response?.error) {
        message.warning(response.error)
      } else {
        const results = Array.isArray(response?.results) ? response.results : []
        const failed = results.filter((item) => item.success === false && !item.cancelled && item.status !== 'not_found' && item.status !== 'needs_review').length
        const notFound = results.filter((item) => item.status === 'not_found').length
        const needsReview = results.filter((item) => item.status === 'needs_review').length
        const imageMissing = results.filter((item) => item.status === 'image_missing').length
        const skipped = results.filter((item) => item.skipped).length

        const parts = [
          `동기화 완료: 처리 ${response?.processed || 0} / ${response?.total || 0}`,
          `실패 ${failed}`,
          `Person 없음 ${notFound}`,
          `검수 필요 ${needsReview}`,
          `이미지 없음 ${imageMissing}`,
          `건너뜀 ${skipped}`,
        ]
        message.success(parts.join(', '))

        if (notFound > 0 && failed === 0) {
          message.info('일부 배우는 Jellyfin Person이 아직 없어 보류되었습니다. 라이브러리 메타데이터 새로고침 후 다시 시도하세요.')
        }
      }
      await loadItems({ refreshChanged: true })
    } catch (error) {
      message.error(`동기화 실패: ${error.message}`)
    } finally {
      setBusy(false)
      setProgress(null)
      setActiveRequestId('')
    }
  }, [loadItems])

  const handleCancelSync = useCallback(async () => {
    if (!activeRequestId) return
    await window.api.cancelJellyfinActorSync({ requestId: activeRequestId })
    message.info('동기화 취소를 요청했습니다.')
  }, [activeRequestId])

  const openMatchModal = useCallback(async () => {
    if (selectedItems.length !== 1) {
      message.info('검수할 배우 1명을 선택해 주세요.')
      return
    }

    const actor = selectedItems[0]
    setMatchActor(actor)
    setMatchModalOpen(true)
    setMatchLoading(true)
    setMatchResult(null)

    try {
      const result = await window.api.searchJellyfinPersonCandidates({ actorId: actor.id })
      setMatchResult(result)
    } catch (error) {
      message.error(`후보 검색 실패: ${error.message}`)
    } finally {
      setMatchLoading(false)
    }
  }, [selectedItems])

  const handleLink = useCallback(async (candidate) => {
    if (!matchActor || !candidate?.Id) return
    await window.api.linkJellyfinActorPerson({
      actorId: matchActor.id,
      personId: candidate.Id,
      personName: candidate.Name || '',
    })
    message.success('배우와 Jellyfin Person을 연결했습니다.')
    setMatchModalOpen(false)
    await loadItems()
  }, [loadItems, matchActor])

  const handleUnlink = useCallback(async () => {
    if (selectedItems.length !== 1) {
      message.info('연결 해제할 배우 1명을 선택해 주세요.')
      return
    }
    const actor = selectedItems[0]
    await window.api.unlinkJellyfinActorPerson({ actorId: actor.id })
    message.success('연결을 해제했습니다.')
    await loadItems()
  }, [loadItems, selectedItems])

  const columns = [
    {
      title: '배우명',
      dataIndex: 'name',
      width: 180,
      render: (value, record) => (
        <div>
          <strong>{value}</strong>
          {record.aliases ? <div style={{ color: '#64748b', fontSize: 12 }}>{record.aliases}</div> : null}
        </div>
      ),
    },
    {
      title: 'Person',
      dataIndex: 'jellyfin_matched_name',
      width: 180,
      render: (value) => value || '—',
    },
    {
      title: 'Person ID',
      dataIndex: 'jellyfin_person_id',
      width: 130,
      render: (value) => shortPersonId(value),
    },
    {
      title: '상태',
      dataIndex: 'jellyfin_sync_status',
      width: 120,
      render: (value) => <Tag color={statusColor(value)}>{value || 'not_synced'}</Tag>,
    },
    {
      title: '이미지',
      dataIndex: 'jellyfin_image_synced_at',
      width: 120,
      render: (value, row) => row.image_path ? (value ? '완료' : '대기') : '없음',
    },
    {
      title: '마지막 동기화',
      dataIndex: 'jellyfin_synced_at',
      width: 180,
      render: (value) => value || '—',
    },
    {
      title: '오류',
      dataIndex: 'jellyfin_sync_error',
      ellipsis: true,
      render: (value) => value || '—',
    },
  ]

  return (
    <div className="jellyfin-actor-sync-tab">
      <Alert
        type="info"
        showIcon
        message="Person이 보이지 않으면 Jellyfin 라이브러리 메타데이터를 먼저 새로고침하세요. 작품 NFO 반영도 Person 생성에 도움이 됩니다."
      />

      <Card size="small" className="jellyfin-actor-sync-settings">
        <Form form={form} layout="vertical">
          <Space wrap style={{ width: '100%' }} size={12}>
            <Form.Item label="Jellyfin 서버 URL" name="serverUrl" rules={[{ required: true, message: '서버 URL을 입력하세요.' }]}>
              <Input placeholder="http://localhost:8096" style={{ width: 260 }} />
            </Form.Item>
            <Form.Item label="API Key" name="apiKey" tooltip="비워두면 기존 저장값 유지">
              <Input.Password placeholder="Jellyfin API Key" style={{ width: 260 }} />
            </Form.Item>
            <Form.Item
              label="User ID"
              name="userId"
              rules={[
                {
                  validator: (_rule, value) => {
                    const text = String(value || '').trim()
                    if (isJellyfinUserId(text)) return Promise.resolve()
                    return Promise.reject(new Error('User ID는 UUID 또는 32자리 hex 형식이어야 합니다.'))
                  },
                },
              ]}
            >
              <Input placeholder="User ID (비우면 자동 탐색)" style={{ width: 260 }} />
            </Form.Item>
          </Space>
          <Typography.Text type="secondary">
            {resolvedUserName
              ? `연결된 사용자명: ${resolvedUserName} (User ID만 저장됩니다)`
              : 'User ID는 UUID 또는 32자리 hex 형식을 사용하세요. 사용자명은 입력하지 않습니다.'}
          </Typography.Text>
          <Space wrap size={12}>
            <Form.Item name="overwriteOverview" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>Overview 덮어쓰기</Checkbox>
            </Form.Item>
            <Form.Item name="replacePrimaryImage" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>Primary Image 교체</Checkbox>
            </Form.Item>
            <Form.Item name="forceNameUpdate" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>이름 강제 갱신</Checkbox>
            </Form.Item>
            <Form.Item name="includeArchived" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>아카이브 포함</Checkbox>
            </Form.Item>
          </Space>
          <Space wrap>
            <Button onClick={testConnection}>연결 테스트</Button>
            <Button type="primary" loading={savingSettings} onClick={saveSettings}>설정 저장</Button>
          </Space>
        </Form>
      </Card>

      <Card size="small" className="jellyfin-actor-sync-controls">
        <Space wrap>
          <Select value={filterStatus} options={STATUS_OPTIONS} style={{ width: 170 }} onChange={setFilterStatus} />
          <Input.Search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onSearch={() => loadItems({ refreshChanged: true })}
            placeholder="배우명/별칭/Person 검색"
            style={{ width: 260 }}
            allowClear
          />
          <Button onClick={() => loadItems({ refreshChanged: true })}>새로고침</Button>
        </Space>
        <Space wrap style={{ marginTop: 12 }}>
          <Button type="primary" onClick={() => runSync('test')} loading={busy}>테스트 배우 1명 동기화</Button>
          <Button onClick={() => runSync('selected', { actorIds: selectedRowKeys })} disabled={selectedRowKeys.length === 0 || busy}>선택 배우 동기화</Button>
          <Button onClick={() => runSync('unsynced')} loading={busy}>미동기화 배우 동기화</Button>
          <Button onClick={() => runSync('changed')} loading={busy}>변경된 배우만 동기화</Button>
          <Button danger onClick={() => runSync('force', { actorIds: selectedRowKeys })} disabled={selectedRowKeys.length === 0 || busy}>선택 배우 강제 재동기화</Button>
          <Button onClick={openMatchModal} disabled={selectedRowKeys.length !== 1}>매칭 검수</Button>
          <Button onClick={handleUnlink} disabled={selectedRowKeys.length !== 1}>연결 해제</Button>
          <Button onClick={handleCancelSync} disabled={!activeRequestId}>취소</Button>
        </Space>

        {progress?.total ? (
          <div style={{ marginTop: 12 }}>
            <Typography.Text>{progress.actorName || '배우'} · {progress.stage || 'processing'} · {progress.message || ''}</Typography.Text>
            <Progress percent={Math.round(((Number(progress.processed || 0) + 1) / Number(progress.total || 1)) * 100)} />
          </div>
        ) : null}
      </Card>

      <Card size="small">
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={visibleItems}
          columns={columns}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{ pageSize: 30, showSizeChanger: true, pageSizeOptions: [20, 30, 50, 100] }}
          scroll={{ x: 1280, y: 420 }}
        />
      </Card>

      <Modal
        open={matchModalOpen}
        title={matchActor ? `매칭 검수: ${matchActor.name}` : '매칭 검수'}
        onCancel={() => setMatchModalOpen(false)}
        footer={null}
        width={880}
      >
        {matchLoading ? <Typography.Text>후보를 조회하는 중입니다...</Typography.Text> : null}
        {!matchLoading && matchResult ? (
          <div>
            <Typography.Paragraph>
              판정: <strong>{matchResult.type}</strong> ({matchResult.method || 'unknown'})
              {matchResult.reason ? ` · ${matchResult.reason}` : ''}
            </Typography.Paragraph>
            <Table
              rowKey="Id"
              size="small"
              pagination={false}
              dataSource={Array.isArray(matchResult.candidates) ? matchResult.candidates : []}
              columns={[
                { title: 'Person 이름', dataIndex: 'Name', render: (value) => value || '—' },
                { title: 'Person ID', dataIndex: 'Id', width: 220 },
                {
                  title: '동작',
                  width: 120,
                  render: (_, row) => <Button type="link" onClick={() => handleLink(row)}>이 Person과 연결</Button>,
                },
              ]}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
