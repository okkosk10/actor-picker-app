'use strict'

/**
 * electron/clipboardHelper.cjs
 * Windows 파일 클립보드 헬퍼 (CF_HDROP 방식)
 *
 * 구현 방식:
 *   1. 파일 경로를 UTF-8 BOM 임시 텍스트 파일에 기록한다.
 *      (실제 영상 파일을 임시 폴더로 복사하지 않음)
 *   2. PowerShell -STA -EncodedCommand 를 통해
 *      System.Windows.Forms.Clipboard.SetFileDropList 를 호출한다.
 *   3. SetFileDropList 는 내부적으로 copy=true 로 OleFlushClipboard 를 호출하므로
 *      PowerShell 프로세스가 종료된 후에도 클립보드 데이터가 유지된다.
 *   4. 사용자는 Windows 탐색기(및 MTP 연결 장치 포함)에서 Ctrl+V 로 붙여넣기 가능하다.
 *
 * 보안:
 *   - filePaths 입력 유효성 검사는 ipc.cjs 의 핸들러에서 수행한다.
 *   - PowerShell 스크립트는 UTF-16 LE Base64(-EncodedCommand)로 전달하여
 *     경로에 포함된 Unicode(한글 등) 문자를 안전하게 처리한다.
 *   - 임시 파일 이름은 암호학적 랜덤 hex 를 사용한다.
 */

const { spawn }  = require('child_process')
const crypto     = require('crypto')
const os         = require('os')
const fs         = require('fs')
const path       = require('path')

/**
 * Windows 파일 클립보드에 CF_HDROP 형식으로 파일 목록을 복사한다.
 *
 * @param {string[]} filePaths - 복사할 파일의 절대 경로 배열 (이미 존재 확인 완료된 목록)
 * @returns {Promise<{ count: number }>}
 */
async function copyFilesToClipboard(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('복사할 파일이 없습니다.')
  }

  // ── 임시 경로 목록 파일 ───────────────────────────────────────
  // 파일명은 ASCII 전용 hex → tmpFile 경로 자체에 한글 포함 가능한 os.tmpdir() 와 결합
  const tmpFileName = `acp-${crypto.randomBytes(8).toString('hex')}.txt`
  const tmpFile     = path.join(os.tmpdir(), tmpFileName)
  const bom         = Buffer.from([0xEF, 0xBB, 0xBF]) // UTF-8 BOM
  fs.writeFileSync(
    tmpFile,
    Buffer.concat([bom, Buffer.from(filePaths.join('\n'), 'utf8')]),
  )

  // ── PowerShell 스크립트 ───────────────────────────────────────
  // tmpFile 경로에서 단일 인용 문자(') 이스케이프 → PS 단일 인용 문자열 안전
  const tmpSafe  = tmpFile.replace(/'/g, "''")
  const psLines  = [
    `$ErrorActionPreference = 'Stop'`,
    `Add-Type -AssemblyName System.Windows.Forms`,
    `$col = New-Object System.Collections.Specialized.StringCollection`,
    `Get-Content -LiteralPath '${tmpSafe}' | ForEach-Object {`,
    `  $f = $_.Trim()`,
    `  if ($f -ne '') { [void]$col.Add($f) }`,
    `}`,
    `[System.Windows.Forms.Clipboard]::SetFileDropList($col)`,
    `Remove-Item -LiteralPath '${tmpSafe}' -ErrorAction SilentlyContinue`,
    `Write-Output "OK:$($col.Count)"`,
  ]
  const psScript = psLines.join('\r\n')

  // UTF-16 LE Base64 인코딩 → -EncodedCommand 로 전달 (Unicode 경로 완전 지원)
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64')

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'powershell.exe',
      ['-STA', '-NonInteractive', '-NoProfile', '-EncodedCommand', encoded],
      { windowsHide: true },
    )

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (d) => { stdout += d.toString('utf8') })
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8') })

    proc.on('close', (code) => {
      // PS 스크립트 내에서 삭제하지만 안전을 위해 재시도
      try { fs.unlinkSync(tmpFile) } catch { /* 이미 삭제됨 */ }

      const out   = stdout.trim()
      const match = out.match(/OK:(\d+)/)
      if (code === 0 && match) {
        resolve({ count: parseInt(match[1], 10) })
      } else {
        reject(new Error(stderr.trim() || `PowerShell 실패 (종료 코드: ${code})\n${out}`))
      }
    })

    proc.on('error', (err) => {
      try { fs.unlinkSync(tmpFile) } catch { /* 무시 */ }
      reject(new Error(`PowerShell 실행 실패: ${err.message}`))
    })
  })
}

module.exports = { copyFilesToClipboard }
