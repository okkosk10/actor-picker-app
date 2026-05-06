/**
 * src/hooks/useVideoSearch.js
 * 동영상 목록 검색 상태 관리 커스텀 훅
 *
 * 관리 상태:
 *   videos         - 현재 조회된 영상 목록
 *   searchQuery    - 검색 키워드
 *   sortBy         - 정렬 기준 (SORT_OPTIONS value)
 *   hideMissing    - 삭제된 파일 숨김 여부
 *   currentFolder  - 현재 선택된 폴더 경로 (null이면 전체 라이브러리)
 *   loading        - 로딩 중 여부
 *   error          - 에러 메시지
 *
 * 제공 함수:
 *   search(q)              - 검색 키워드 변경 + 재조회
 *   changeSort(key)        - 정렬 변경 + 재조회
 *   toggleHideMissing(val) - 삭제 파일 숨김 토글 + 재조회
 *   changeFolder(path)     - 현재 폴더 변경 + 재조회 (null이면 전체 라이브러리)
 *   refresh()              - 현재 조건으로 재조회
 *   setVideos(updater)     - 목록 직접 수정 (외부 업데이트 동기화용)
 */

import { useState, useCallback, useEffect } from 'react'

export function useVideoSearch() {
  const [videos,         setVideos]         = useState([])
  const [searchQuery,    setSearchQuery]    = useState('')
  const [sortBy,         setSortBy]         = useState('created_desc')
  const [hideMissing,    setHideMissing]    = useState(true)
  // currentFolder: null → 전체 라이브러리, string → 해당 폴더만 표시
  const [currentFolder,  setCurrentFolder]  = useState(null)
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState(null)

  /**
   * DB에서 영상 목록을 조회하여 videos 상태를 업데이트한다.
   * 인자를 직접 받아 이전 상태에 의존하지 않도록 설계 (stale closure 방지)
   *
   * @param {string}      query  - 검색 키워드
   * @param {string}      sort   - 정렬 키
   * @param {boolean}     hide   - missing 숨김 여부
   * @param {string|null} folder - 폴더 필터 (null이면 전체)
   */
  const loadVideos = useCallback(async (query, sort, hide, folder) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.searchVideos(query, {
        sortBy:        sort,
        hideMissing:   hide,
        currentFolder: folder,   // null이면 전체 라이브러리 조회
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
    loadVideos('', 'created_desc', true, null)
  }, [loadVideos])

  /** 검색 키워드 변경 */
  const search = useCallback((q) => {
    setSearchQuery(q)
    loadVideos(q, sortBy, hideMissing, currentFolder)
  }, [sortBy, hideMissing, currentFolder, loadVideos])

  /** 정렬 기준 변경 */
  const changeSort = useCallback((sort) => {
    setSortBy(sort)
    loadVideos(searchQuery, sort, hideMissing, currentFolder)
  }, [searchQuery, hideMissing, currentFolder, loadVideos])

  /** 삭제 파일 숨김 토글 */
  const toggleHideMissing = useCallback((hide) => {
    setHideMissing(hide)
    loadVideos(searchQuery, sortBy, hide, currentFolder)
  }, [searchQuery, sortBy, currentFolder, loadVideos])

  /**
   * 현재 폴더 변경 + 즉시 재조회
   * @param {string|null} folder - 새 폴더 경로 (null이면 전체 라이브러리)
   */
  const changeFolder = useCallback((folder) => {
    setCurrentFolder(folder)
    loadVideos(searchQuery, sortBy, hideMissing, folder)
  }, [searchQuery, sortBy, hideMissing, loadVideos])

  /** 현재 조건으로 재조회 (스캔 후 갱신 등) */
  const refresh = useCallback(() => {
    loadVideos(searchQuery, sortBy, hideMissing, currentFolder)
  }, [searchQuery, sortBy, hideMissing, currentFolder, loadVideos])

  return {
    videos,
    setVideos,    // DetailPanel 업데이트 동기화용
    searchQuery,
    search,
    sortBy,
    changeSort,
    hideMissing,
    toggleHideMissing,
    currentFolder,
    changeFolder,
    loading,
    error,
    setError,
    refresh,
  }
}
