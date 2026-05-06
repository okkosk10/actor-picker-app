'use strict'

/**
 * electron/clipboardHelper.cjs
 * Windows 파일 클립보드 헬퍼 (DataObject + Preferred DropEffect 방식)
 *
 * 구현 방식:
 *   1. 파일 경로를 UTF-8 BOM 임시 텍스트 파일에 기록한다.
 *      (실제 영상 파일을 임시 폴더로 복사하지 않음)
 *   2. PowerShell -STA -EncodedCommand 를 통해
 *      System.Windows.Forms.DataObject 를 생성하고 아래 두 포맷을 등록한다.
 *        - DataFormats.FileDrop  : string[] 파일 경로 목록 (CF_HDROP)
 *        - "Preferred DropEffect": MemoryStream([1,0,0,0]) → DROPEFFECT_COPY = 1
 *   3. Clipboard.SetDataObject(dataObject, $true) 로 클립보드에 등록한다.
 *      copy=true 이므로 PowerShell 프로세스가 종료된 후에도 데이터가 유지된다.
 *   4. Preferred DropEffect 포맷 덕분에 Windows Explorer 및 MTP 장치가
 *      붙여넣기 시 "이동"이 아닌 "복사" 동작을 수행한다.
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
    // 파일 경로 읽기 → 빈 줄 제거 → string[] 로 강제 변환
    `$paths = @(Get-Content -LiteralPath '${tmpSafe}' |`,
    `  ForEach-Object { $_.Trim() } |`,
    `  Where-Object { $_ -ne '' })`,
    // DataObject 생성
    `$dataObj = New-Object System.Windows.Forms.DataObject`,
    // FileDrop 포맷 등록 (CF_HDROP) – autoConvert=$false
    `$dataObj.SetData([System.Windows.Forms.DataFormats]::FileDrop, $false, [string[]]$paths)`,
    // Preferred DropEffect = DROPEFFECT_COPY (1) 를 MemoryStream 으로 등록
    // CFSTR_PREFERREDDROPEFFECT 포맷: Little-Endian 4바이트 정수
    `$ms = New-Object System.IO.MemoryStream(,[byte[]](1,0,0,0))`,
    `$dataObj.SetData('Preferred DropEffect', $false, $ms)`,
    // 클립보드에 등록 – copy=$true → OleFlushClipboard → 프로세스 종료 후에도 유지
    `[System.Windows.Forms.Clipboard]::SetDataObject($dataObj, $true)`,
    `Remove-Item -LiteralPath '${tmpSafe}' -ErrorAction SilentlyContinue`,
    `Write-Output "OK:$($paths.Count)"`,
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

/**
 * Shell.Application 기반 MTP 순차 전송 세션 (큐 모드)
 *
 * 프로토콜:
 *   (시작)                    → READY | CANCEL | ERR:<msg>
 *   SEND:<timeoutSec>:<path>  → OK | TIMEOUT | ERR:<msg>   (CopyHere + Poll)
 *   POLL:<timeoutSec>:<path>  → OK | TIMEOUT               (Poll only, CopyHere 없음)
 *   QUIT                      → (프로세스 종료)
 *
 * Poll-Item: 순수 timeout 방식. 파일이 Items()에 나타날 때까지 대기한다.
 * staleSec 버그(원래 코드에서 $lastTick이 갱신되지 않아 staleSec=2분이
 * 사실상 timeout으로 작동하던 문제) 완전 제거.
 */

// HWND 를 스크립트 빌드 시 숫자 리터럴로 치환 (인젝션 불가 - 숫자만 허용)
const MTP_SESSION_SCRIPT_TPL = `
$ErrorActionPreference = 'Continue'
$shell = New-Object -ComObject Shell.Application

function Poll-Item {
  param($destFolder, $name, $timeoutSec)
  $deadline = [DateTime]::Now.AddSeconds($timeoutSec)
  while ([DateTime]::Now -lt $deadline) {
    Start-Sleep -Seconds 5
    try {
      $items = @($destFolder.Items() | ForEach-Object { $_.Name })
      if ($items -contains $name) {
        Start-Sleep -Seconds 3
        return 'OK'
      }
    } catch {}
  }
  return 'TIMEOUT'
}

$dest = $shell.BrowseForFolder(HWND_PLACEHOLDER, '복사할 위치를 선택하세요 (휴대폰 폴더 포함)', 0, 17)
if (-not $dest) { [Console]::WriteLine('CANCEL'); exit 0 }
[Console]::WriteLine('READY')

$stdinReader = [System.Console]::In
while ($true) {
  $line = $stdinReader.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq 'QUIT') { break }

  if ($line -match '^SEND:(\d+):(.+)$') {
    $timeoutSec = [int]$Matches[1]
    $filePath   = $Matches[2]
    try {
      $dest.CopyHere($filePath, 0)
      $name   = [System.IO.Path]::GetFileName($filePath)
      $result = Poll-Item -destFolder $dest -name $name -timeoutSec $timeoutSec
      [Console]::WriteLine($result)
    } catch { [Console]::WriteLine("ERR:$_") }
    continue
  }

  if ($line -match '^POLL:(\d+):(.+)$') {
    $timeoutSec = [int]$Matches[1]
    $filePath   = $Matches[2]
    $name       = [System.IO.Path]::GetFileName($filePath)
    $result     = Poll-Item -destFolder $dest -name $name -timeoutSec $timeoutSec
    [Console]::WriteLine($result)
    continue
  }
}
`.trim()

/**
 * 파일 크기 기반 timeout 계산
 *   최소 10분, 1GB당 7분, 10GB→70분, 20GB→140분
 * @param {number} sizeBytes
 * @returns {number} seconds
 */
function calcTimeoutSec(sizeBytes) {
  const MIN_SEC  = 10 * 60
  const sizeGB   = (sizeBytes || 0) / (1024 ** 3)
  const bySizeSec = Math.ceil(sizeGB * 7 * 60)
  return Math.max(MIN_SEC, bySizeSec)
}

/**
 * MTP 순차 전송 세션 생성.
 * BrowseForFolder 선택 후 SEND/POLL 명령을 개별 파일에 사용한다.
 *
 * @param {number} hwnd
 * @returns {Promise<MtpSession|null>}  null = 취소
 */
async function createMtpSession(hwnd) {
  const hwndVal = (Number.isInteger(hwnd) && hwnd > 0) ? hwnd : 0
  const script  = MTP_SESSION_SCRIPT_TPL.replace('HWND_PLACEHOLDER', hwndVal.toString())
  const encoded = Buffer.from(script, 'utf16le').toString('base64')

  const proc = spawn(
    'powershell.exe',
    ['-STA', '-NoProfile', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  )

  let stdoutBuf = ''
  let closed    = false

  proc.on('close', () => { closed = true })
  proc.stderr.on('data', () => {})
  proc.stdout.on('data', (d) => { stdoutBuf += d.toString('utf8') })

  const readLine = () => new Promise((resolve, reject) => {
    const check = () => {
      if (closed && !stdoutBuf.includes('\n')) return reject(new Error('프로세스 종료'))
      const idx = stdoutBuf.indexOf('\n')
      if (idx !== -1) {
        const line = stdoutBuf.slice(0, idx).trim()
        stdoutBuf  = stdoutBuf.slice(idx + 1)
        return resolve(line)
      }
      setTimeout(check, 50)
    }
    check()
  })

  const send = (cmd) => { proc.stdin.write(cmd + '\n') }

  const browseResult = await readLine()
  if (browseResult === 'CANCEL') { send('QUIT'); return null }
  if (browseResult !== 'READY')  { send('QUIT'); throw new Error(`폴더 선택 오류: ${browseResult}`) }

  return {
    /** CopyHere + Poll */
    sendFile: async (filePath, timeoutSec) => {
      send(`SEND:${timeoutSec}:${filePath}`)
      const r = await readLine()
      if (r === 'OK') return 'ok'
      if (r === 'TIMEOUT') return 'timeout'
      return 'error'
    },
    /** Poll only (CopyHere 없음) — "계속 대기" 용도 */
    pollFile: async (filePath, timeoutSec) => {
      send(`POLL:${timeoutSec}:${filePath}`)
      const r = await readLine()
      return r === 'OK' ? 'ok' : 'timeout'
    },
    close: () => {
      try { send('QUIT') }    catch { /* 무시 */ }
      try { proc.stdin.end() } catch { /* 무시 */ }
    },
  }
}

/**
 * MTP 안정 모드(일괄 전송) — c7783d4 copyFilesToDevice 패턴 그대로 사용
 *
 * temp 파일에 경로를 기록 → Get-Content 로 읽기 → foreach CopyHere →
 * 폴링 루프로 프로세스 유지(COM 아파트 유지) → 완료/timeout 반환
 *
 * @param {number}   hwnd
 * @param {string[]} filePaths
 * @returns {Promise<{action:'copied'|'cancelled'|'timeout', count:number}|null>}
 */
async function createMtpBulkSession(hwnd, filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return null

  const hwndVal     = (Number.isInteger(hwnd) && hwnd > 0) ? hwnd : 0
  const tmpFileName = `acp-bulk-${crypto.randomBytes(8).toString('hex')}.txt`
  const tmpFile     = path.join(os.tmpdir(), tmpFileName)
  const bom         = Buffer.from([0xEF, 0xBB, 0xBF])
  fs.writeFileSync(tmpFile, Buffer.concat([bom, Buffer.from(filePaths.join('\n'), 'utf8')]))

  const tmpSafe = tmpFile.replace(/'/g, "''")

  // c7783d4의 copyFilesToDevice 와 동일한 PS 스크립트 구조
  const psLines = [
    `$ErrorActionPreference = 'Stop'`,
    `$paths = @(Get-Content -LiteralPath '${tmpSafe}' |`,
    `  ForEach-Object { $_.Trim() } |`,
    `  Where-Object { $_ -ne '' })`,
    `Remove-Item -LiteralPath '${tmpSafe}' -ErrorAction SilentlyContinue`,
    `if ($paths.Count -eq 0) { Write-Output 'ERR:파일 없음'; exit 1 }`,
    `$shell = New-Object -ComObject Shell.Application`,
    `$dest = $shell.BrowseForFolder(${hwndVal}, '복사할 위치를 선택하세요 (휴대폰 폴더 포함)', 0, 17)`,
    `if (-not $dest) { Write-Output 'CANCEL'; exit 0 }`,
    // flags=0: Windows 표준 복사 진행 창 표시
    `foreach ($p in $paths) { $dest.CopyHere($p, 0) }`,
    // CopyHere 는 비동기 → 폴링 루프로 프로세스(COM 아파트) 유지 (완료될 때까지 무한 대기)
    `$names = @($paths | ForEach-Object { [System.IO.Path]::GetFileName($_) })`,
    `$left  = $names`,
    `while ($left.Count -gt 0) {`,
    `  Start-Sleep -Seconds 3`,
    `  try {`,
    `    $have = @($dest.Items() | ForEach-Object { $_.Name })`,
    `    $left = @($names | Where-Object { $have -notcontains $_ })`,
    `  } catch {}`,
    `}`,
    `Write-Output "OK:$($names.Count)"`,
  ]
  const psScript = psLines.join('\r\n')
  const encoded  = Buffer.from(psScript, 'utf16le').toString('base64')

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'powershell.exe',
      ['-STA', '-NoProfile', '-EncodedCommand', encoded],
      { windowsHide: true },
    )

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d.toString('utf8') })
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8') })

    proc.on('close', (code) => {
      try { fs.unlinkSync(tmpFile) } catch { /* 이미 삭제됨 */ }
      const out = stdout.trim()
      if (out === 'CANCEL') return resolve({ action: 'cancelled', count: 0 })
      const okMatch = out.match(/OK:(\d+)/)
      if (code === 0 && okMatch) return resolve({ action: 'copied', count: parseInt(okMatch[1], 10) })
      const toMatch = out.match(/TIMEOUT:(\d+)\/\d+/)
      if (toMatch) return resolve({ action: 'timeout', count: parseInt(toMatch[1], 10) })
      reject(new Error(stderr.trim() || `PowerShell 실패 (종료 코드: ${code})\n${out}`))
    })

    proc.on('error', (err) => {
      try { fs.unlinkSync(tmpFile) } catch { /* 무시 */ }
      reject(new Error(`PowerShell 실행 실패: ${err.message}`))
    })
  })
}

module.exports = { copyFilesToClipboard, createMtpSession, createMtpBulkSession, calcTimeoutSec }
