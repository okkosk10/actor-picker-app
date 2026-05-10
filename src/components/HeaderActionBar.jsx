/**
 * src/components/HeaderActionBar.jsx
 * 탭별 상단 액션 버튼 바
 *
 * Props:
 *   appTab         {string}   - 현재 앱 탭 ('library' | 'actors' | 'recommendations' | 'dashboard')
 *   tabMode        {string}   - 영상관리 탭의 서브탭 ('all' | 'new' | 'recommended')
 *   videos         {Video[]}  - 현재 영상 목록 (버튼 비활성화 판단용)
 *   checkedIds     {Set}      - 체크박스 선택 ID 집합
 *   scanning       {boolean}  - 스캔 중 여부
 *   actorPicking   {boolean}  - 배우별 추출 중 여부
 *   folderPath     {string|null}
 *   onSelectFolder {Function}
 *   onScan         {Function}
 *   onRandomPick   {Function}
 *   onActorPick    {Function}
 *   onOpenFileCopy {Function}
 *   onShowDeleteModal {Function}
 *   onRefreshNew   {Function} - NEW 탭 새 파일 다시 검색
 *   onClearCheckedNew {Function} - 선택 NEW 해제
 *   onClearAllNew  {Function} - 전체 NEW 해제
 *   onNewActor     {Function} - 배우 추가 (배우탭 전용)
 *   onSync         {Function} - 배우-영상 동기화
 *   onRecRefresh   {Function} - 추천 새로고침
 *   onDashRefresh  {Function} - 통계 새로고침
 */
export default function HeaderActionBar({
  appTab,
  tabMode,
  videos = [],
  checkedIds = new Set(),
  scanning = false,
  actorPicking = false,
  folderPath = null,
  isAutoScanning = false,
  onSelectFolder,
  onScan,
  onRandomPick,
  onActorPick,
  onOpenFileCopy,
  onShowDeleteModal,
  onRefreshNew,
  onClearCheckedNew,
  onClearAllNew,
  onNewActor,
  onSync,
  onRecRefresh,
  onDashRefresh,
}) {
  // ── 영상관리 탭 (전체/추천) ─────────────────────────────────
  if (appTab === 'library' && tabMode !== 'new') {
    return (
      <div className="header-actions">
        <button className="btn-primary" type="button" onClick={onSelectFolder}>
          📁 폴더 선택
        </button>
        {folderPath && (
          <span className="header-path" title={folderPath}>{folderPath}</span>
        )}
        <button
          className="btn-secondary"
          type="button"
          onClick={onScan}
          disabled={scanning || isAutoScanning}
        >
          {scanning ? '스캔 중…' : (folderPath ? '📂 스캔' : '🔄 전체 스캔')}
        </button>
        <button
          className="btn-random"
          type="button"
          onClick={onRandomPick}
          disabled={videos.length === 0}
        >
          🎲 랜덤 추천
        </button>
        <button
          className="btn-actor-pick"
          type="button"
          onClick={onActorPick}
          disabled={videos.length === 0 || actorPicking}
        >
          {actorPicking ? '추출 중…' : '🎯 배우별 1개 추출'}
        </button>
        <button
          className="btn-or-copy"
          type="button"
          onClick={onOpenFileCopy}
          disabled={videos.length === 0}
        >
          {checkedIds.size > 0
            ? `📂 파일 복사 (${checkedIds.size}개 선택됨)`
            : '📂 파일 복사'}
        </button>
        <button
          className="btn-danger"
          type="button"
          onClick={onShowDeleteModal}
        >
          🗑 삭제요망 정리
        </button>
      </div>
    )
  }

  // ── NEW 탭 ──────────────────────────────────────────────────
  if (appTab === 'library' && tabMode === 'new') {
    return (
      <div className="header-actions">
        <button
          className="btn-secondary"
          type="button"
          onClick={onRefreshNew}
          disabled={scanning || isAutoScanning}
        >
          🔄 새 파일 다시 검색
        </button>
        <button
          className="btn-or-copy"
          type="button"
          onClick={onOpenFileCopy}
          disabled={checkedIds.size === 0}
        >
          {checkedIds.size > 0
            ? `📂 선택 파일 복사 (${checkedIds.size}개)`
            : '📂 선택 파일 복사'}
        </button>
        <button
          className="btn-secondary"
          type="button"
          onClick={onClearCheckedNew}
          disabled={checkedIds.size === 0}
        >
          ✅ 선택 NEW 해제
        </button>
        <button
          className="btn-secondary"
          type="button"
          onClick={onClearAllNew}
          disabled={videos.length === 0}
        >
          ✅ 전체 NEW 해제
        </button>
      </div>
    )
  }

  // ── 배우관리 탭 ─────────────────────────────────────────────
  if (appTab === 'actors') {
    return (
      <div className="header-actions">
        <button className="btn-primary" type="button" onClick={onNewActor}>
          + 배우 추가
        </button>
        <button
          className="btn-secondary"
          type="button"
          onClick={onSync}
          title="videos.actor_name 기반 video_actors 재동기화"
        >
          🔄 배우-영상 동기화
        </button>
      </div>
    )
  }

  // ── 추천 탭 ─────────────────────────────────────────────────
  if (appTab === 'recommendations') {
    return (
      <div className="header-actions">
        <button className="btn-primary" type="button" onClick={onRecRefresh}>
          🔄 추천 새로고침
        </button>
        {checkedIds.size > 0 && (
          <button
            className="btn-or-copy"
            type="button"
            onClick={onOpenFileCopy}
          >
            📂 선택 파일 복사 ({checkedIds.size}개)
          </button>
        )}
      </div>
    )
  }

  // ── 대시보드 탭 ─────────────────────────────────────────────
  if (appTab === 'dashboard') {
    return (
      <div className="header-actions">
        <button className="btn-primary" type="button" onClick={onDashRefresh}>
          🔄 통계 새로고침
        </button>
      </div>
    )
  }

  return null
}
