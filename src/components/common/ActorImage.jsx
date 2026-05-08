/**
 * src/components/common/ActorImage.jsx
 * 배우 이미지 표시 컴포넌트
 *
 * IPC → base64 data URL 방식으로 이미지를 로드한다.
 * (커스텀 프로토콜 대신 이 방식을 사용해 Windows 호환성 보장)
 *
 * Props:
 *   fileName         {string|null} - DB에 저장된 파일명 (경로 아님)
 *   alt              {string}      - img alt 텍스트
 *   className        {string}      - img 엘리먼트 클래스
 *   placeholderClass {string}      - placeholder span 클래스
 *   placeholder      {string}      - placeholder 내용 (기본 👤)
 */
import { useState, useEffect } from 'react'

export default function ActorImage({
  fileName,
  alt            = '',
  className      = '',
  placeholderClass = '',
  placeholder    = '👤',
}) {
  const [src, setSrc] = useState(null)

  useEffect(() => {
    if (!fileName) { setSrc(null); return }
    let alive = true
    window.api.getActorImage(fileName).then((url) => {
      if (alive) setSrc(url || null)
    })
    return () => { alive = false }
  }, [fileName])

  if (!src) {
    return <span className={placeholderClass}>{placeholder}</span>
  }

  return <img src={src} alt={alt} className={className} />
}
