/**
 * src/hooks/useVideoSearch.js
 * 동영상 목록 검색 상태 관리 커스텀 훅
 *
 * 관리 상태:
 *   videos       - 현재 조회된 영상 목록
 *   searchQuery  - 검색 키워드
 *   sortBy       - 정렬 기준 (SORT_OPTIONS value)
 *   hideMissing  - 삭제된 파일 숨김 여부
 *   loading      - 로딩 중 여부
 *   error        - 에러 메시지
 *
 * 제공 함수:
 *   search(q)              - 검색 키워드 변경 + 재조회
 *   changeSort(key)        - 정렬 변경 + 재조회
 *   toggleHideMissing(val) - 삭제 파일 숨김 토글 + 재조회
 *   refresh()              - 현재 조건으로 재조회
 *   setVideos(updater)     - 목록 직접 수정 (외부 업데이트 동기화용)
 */

import { useState, useCallback, useEffect } from 'react'

export function useVideoSearch() {
  const [videos,      setVideos]      = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy,      setSortBy]      = useState('created_desc')
  const [hideMissing, setHideMissing] = useState(true)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)

  /**
   * DB에서 영상 목록을 조회하여 videos 상태를 업데이트한다.
   * 인자를 직접 받아 이전 상태에 의존하지 않도록 설계 (stale closure 방지)
   */
  const loadVideos = useCallback(async (query, sort, hide) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.searchVideos(query, {
        sortBy:      sort,
        hideMissing: hide,
      })
      setVideos(result)
    } catch (e) {
      setError('영상 목록 로드 실패: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, []) // 외부 의존성 없음 → 마운트 시 1회만 생성

  // 앱 시작 시 전체 목록 로드
  useEffect(() => {
    loadVideos('', 'created_desc', true)
  }, [loadVideos])

  /** 검색 키워드 변경 */
  const search = useCallback((q) => {
    setSearchQuery(q)
    loadVideos(q, sortBy, hideMissing)
  }, [sortBy, hideMissing, loadVideos])

  /** 정렬 기준 변경 */
  const changeSort = useCallback((sort) => {
    setSortBy(sort)
    loadVideos(searchQuery, sort, hideMissing)
  }, [searchQuery, hideMissing, loadVideos])

  /** 삭제 파일 숨김 토글 */
  const toggleHideMissing = useCallback((hide) => {
    setHideMissing(hide)
    loadVideos(searchQuery, sortBy, hide)
  }, [searchQuery, sortBy, loadVideos])

  /** 현재 조건으로 재조회 (스캔 후 갱신 등) */
  const refresh = useCallback(() => {
    loadVideos(searchQuery, sortBy, hideMissing)
  }, [searchQuery, sortBy, hideMissing, loadVideos])

  return {
    videos,
    setVideos,    // DetailPanel 업데이트 동기화용
    searchQuery,
    search,
    sortBy,
    changeSort,
    hideMissing,
    toggleHideMissing,
    loading,
    error,
    setError,
    refresh,
  }
}
