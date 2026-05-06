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
 * Shell.Application 기반 직접 복사 (BrowseForFolder + CopyHere)
 *
 * 동작:
 *   - Electron 창의 HWND 를 BrowseForFolder 의 부모로 전달한다.
 *     → 대화상자가 앱 창 위에 정상 표시되며 MTP 장치(휴대폰 폴더)도 포함된다.
 *   - 사용자가 대상 폴더를 선택하면 Shell Folder COM 객체로 CopyHere 를 호출한다.
 *     → Shell.NameSpace(문자열 경로) 방식과 달리 MTP 경로도 직접 처리된다.
 *   - CopyHere flags=0: Windows 표준 복사 진행창 표시, 완료까지 블로킹
 *
 * @param {string[]} filePaths - 복사할 파일의 절대 경로 배열
 * @param {number}   hwnd      - Electron BrowserWindow 의 native HWND (정수)
 * @returns {Promise<{ action: 'copied'|'cancelled', count: number }>}
 */
async function copyFilesToDevice(filePaths, hwnd) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('복사할 파일이 없습니다.')
  }

  const tmpFileName = `acp-dev-${crypto.randomBytes(8).toString('hex')}.txt`
  const tmpFile     = path.join(os.tmpdir(), tmpFileName)
  const bom         = Buffer.from([0xEF, 0xBB, 0xBF])
  fs.writeFileSync(
    tmpFile,
    Buffer.concat([bom, Buffer.from(filePaths.join('\n'), 'utf8')]),
  )

  const tmpSafe = tmpFile.replace(/'/g, "''")
  // HWND 는 정수 리터럴로 스크립트에 직접 삽입 (인젝션 불가 - 숫자만)
  const hwndVal = (Number.isInteger(hwnd) && hwnd > 0) ? hwnd : 0
  const psLines = [
    `$ErrorActionPreference = 'Stop'`,
    `$paths = @(Get-Content -LiteralPath '${tmpSafe}' |`,
    `  ForEach-Object { $_.Trim() } |`,
    `  Where-Object { $_ -ne '' })`,
    `Remove-Item -LiteralPath '${tmpSafe}' -ErrorAction SilentlyContinue`,
    `if ($paths.Count -eq 0) { Write-Output 'ERR:파일 없음'; exit 1 }`,
    `$shell = New-Object -ComObject Shell.Application`,
    // Electron 창 HWND 를 부모로 지정 → 대화상자가 앱 앞에 표시됨
    // rootFolder=17(ssfDRIVES) → "이 PC" 루트, MTP 장치 포함
    `$dest = $shell.BrowseForFolder(${hwndVal}, '복사할 위치를 선택하세요 (휴대폰 폴더 포함)', 0, 17)`,
    `if (-not $dest) { Write-Output 'CANCEL'; exit 0 }`,
    // 문자열 경로 직접 전달 → 로컬↔MTP 네임스페이스 불일치 없음, MTP Shell 핸들러가 직접 읽어 전송
    // flags=0: Windows 표준 복사 진행 창 표시
    `foreach ($p in $paths) { $dest.CopyHere($p, 0) }`,
    // MTP 의 CopyHere 는 비동기 → PowerShell 프로세스가 살아있어야 COM 아파트 유지
    // 대상 폴더에 파일이 나타날 때까지 폴링하여 프로세스를 유지한다 (최대 30분)
    `$names = @($paths | ForEach-Object { [System.IO.Path]::GetFileName($_) })`,
    `$left  = $names`,
    `$dl    = [DateTime]::Now.AddMinutes(30)`,
    `while ($left.Count -gt 0 -and [DateTime]::Now -lt $dl) {`,
    `  Start-Sleep -Seconds 3`,
    `  try {`,
    `    $have = @($dest.Items() | ForEach-Object { $_.Name })`,
    `    $left = @($names | Where-Object { $have -notcontains $_ })`,
    `  } catch {}`,
    `}`,
    `if ($left.Count -eq 0) { Write-Output "OK:$($names.Count)" }`,
    `else { Write-Output "TIMEOUT:$($names.Count - $left.Count)/$($names.Count)" }`,
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

module.exports = { copyFilesToClipboard, copyFilesToDevice }
