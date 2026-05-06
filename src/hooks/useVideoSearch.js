/**
 * src/hooks/useVideoSearch.js
 * 동영상 목록 검색 상태 관리 커스텀 훅
 *
 * 관리 상태:
 *   videos         - 현재 조회된 영상 목록
 *   searchQuery    - 검색 키워드
 *   sortBy         - 정렬 기준 (SORT_OPTIONS value)
 *   filters        - 필터 조건 객체
 *   currentFolder  - 현재 선택된 폴더 경로 (null이면 전체 라이브러리)
 *   loading        - 로딩 중 여부
 *   error          - 에러 메시지
 *
 * 제공 함수:
 *   search(q)              - 검색 키워드 변경 + 재조회
 *   changeSort(key)        - 정렬 변경 + 재조회
 *   changeFilters(patch)   - 필터 부분 업데이트 + 재조회
 *   changeFolder(path)     - 현재 폴더 변경 + 재조회 (null이면 전체 라이브러리)
 *   refresh()              - 현재 조건으로 재조회
 *   setVideos(updater)     - 목록 직접 수정 (외부 업데이트 동기화용)
 */

import { useState, useCallback, useEffect } from 'react'

/**
 * 기본 필터 초기값
 * - excludeMissing / excludeDeleted : 초기에 숨김 (기존 hideMissing=true 동작 유지)
 * - 나머지는 비활성
 */
const DEFAULT_FILTERS = {
  recommendedOnly:    false,   // 추천작만 표시
  excludeDeleteGrade: false,   // 삭제요망 등급 제외
  excludeMissing:     true,    // status='missing' 제외 (기존 hideMissing 기본값 유지)
  excludeDeleted:     true,    // status='deleted' 제외
  grades:             [],      // 빈 배열 = 전체 등급 허용
  minRating:          0,       // 0 = 별점 필터 없음
}

export function useVideoSearch() {
  const [videos,         setVideos]         = useState([])
  const [searchQuery,    setSearchQuery]    = useState('')
  const [sortBy,         setSortBy]         = useState('created_desc')
  const [filters,        setFilters]        = useState(DEFAULT_FILTERS)
  // currentFolder: null → 전체 라이브러리, string → 해당 폴더만 표시
  const [currentFolder,  setCurrentFolder]  = useState(null)
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState(null)

  /**
   * DB에서 영상 목록을 조회하여 videos 상태를 업데이트한다.
   * 인자를 직접 받아 이전 상태에 의존하지 않도록 설계 (stale closure 방지)
   *
   * @param {string}      query   - 검색 키워드
   * @param {string}      sort    - 정렬 키
   * @param {object}      flt     - 필터 조건 객체
   * @param {string|null} folder  - 폴더 필터 (null이면 전체)
   */
  const loadVideos = useCallback(async (query, sort, flt, folder) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.searchVideos(query, {
        sortBy:        sort,
        filters:       flt,
        currentFolder: folder,
      })
      setVideos(result)
    } catch (e) {
      setError('영상 목록 로드 실패: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // 앱 시작 시 기본 조건으로 전체 목록 로드
  useEffect(() => {
    loadVideos('', 'created_desc', DEFAULT_FILTERS, null)
  }, [loadVideos])

  /** 검색 키워드 변경 */
  const search = useCallback((q) => {
    setSearchQuery(q)
    loadVideos(q, sortBy, filters, currentFolder)
  }, [sortBy, filters, currentFolder, loadVideos])

  /** 정렬 기준 변경 */
  const changeSort = useCallback((sort) => {
    setSortBy(sort)
    loadVideos(searchQuery, sort, filters, currentFolder)
  }, [searchQuery, filters, currentFolder, loadVideos])

  /**
   * 필터 부분 업데이트 + 재조회
   * @param {Partial<typeof DEFAULT_FILTERS>} patch - 변경할 필터 키/값
   */
  const changeFilters = useCallback((patch) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch }
      loadVideos(searchQuery, sortBy, next, currentFolder)
      return next
    })
  }, [searchQuery, sortBy, currentFolder, loadVideos])

  /**
   * 현재 폴더 변경 + 즉시 재조회
   * @param {string|null} folder - 새 폴더 경로 (null이면 전체 라이브러리)
   */
  const changeFolder = useCallback((folder) => {
    setCurrentFolder(folder)
    loadVideos(searchQuery, sortBy, filters, folder)
  }, [searchQuery, sortBy, filters, loadVideos])

  /** 현재 조건으로 재조회 (스캔 후 갱신 등) */
  const refresh = useCallback(() => {
    loadVideos(searchQuery, sortBy, filters, currentFolder)
  }, [searchQuery, sortBy, filters, currentFolder, loadVideos])

  return {
    videos,
    setVideos,
    searchQuery,
    search,
    sortBy,
    changeSort,
    filters,
    changeFilters,
    currentFolder,
    changeFolder,
    loading,
    error,
    setError,
    refresh,
  }
}
