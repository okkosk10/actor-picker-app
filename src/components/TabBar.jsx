/**
 * src/components/TabBar.jsx
 * 라이브러리 탭 네비게이션 컴포넌트
 *
 * 탭 목록:
 *   all         : 전체 (currentFolder가 있으면 "현재 폴더")
 *   new         : NEW — 작업 대기함 (is_new=1 인 파일)
 *   recommended : 추천 탭
 *
 * Props:
 *   tabMode      {string}   - 현재 활성 탭 ('all' | 'new' | 'recommended')
 *   onTabChange  {Function} - 탭 전환 콜백 (mode 문자열 전달)
 *   newCount     {number}   - NEW 탭 배지 숫자 (is_new=1 파일 수)
 *   currentFolder {string|null} - 현재 선택 폴더 (null이면 "전체 라이브러리")
 */
export default function TabBar({ tabMode, onTabChange, newCount, currentFolder }) {
  // 탭 정의
  const tabs = [
    {
      key:   'all',
      label: currentFolder ? '현재 폴더' : '전체',
    },
    {
      key:   'new',
      // NEW 카운트가 있으면 배지 표시
      label: newCount > 0 ? `NEW (${newCount})` : 'NEW',
      badge: newCount > 0,
    },
    {
      key:   'recommended',
      label: '⭐ 추천',
    },
  ]

  return (
    <div className="tab-bar" role="tablist" aria-label="라이브러리 탭">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={tabMode === tab.key}
          className={[
            'tab-btn',
            tabMode === tab.key ? 'tab-btn--active' : '',
            tab.key === 'new' && tab.badge ? 'tab-btn--new-badge' : '',
          ].filter(Boolean).join(' ')}
          type="button"
          onClick={() => onTabChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
