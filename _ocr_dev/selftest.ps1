# 旁译 · 交付前自检（一条命令跑完）
#
#   1) 把根目录的 content.js 同步到 e2e\ —— devtest 读的是 e2e\content.js，
#      **不同步就是在验旧文件**（踩过：e2e 那份停在 0.3.1，白验一轮）
#   2) node --check
#   3) 三个离线测试：分段 / 答题解析 / 后台三件
#   4) Edge 无头跑 devtest.html，抓 #out，扫有没有 ✗
#   5) 设置页自检（预设 / 主题 / 保存不丢字段）
#   6) 打包 + 包完整性（manifest 引用的文件必须在产物里）
#
# 用法：powershell -ExecutionPolicy Bypass -File .\selftest.ps1
param(
  [switch]$SkipBrowser,
  [int]$Budget = 20000
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path          # 旁译\_ocr_dev
$root = Split-Path -Parent $here                                  # 旁译
$src  = Join-Path $root 'content.js'
$e2e  = Join-Path $here 'e2e'

Write-Host ''
Write-Host '=== 1) 同步 content.js -> e2e\ ===' -ForegroundColor Cyan
Copy-Item $src (Join-Path $e2e 'content.js') -Force
Write-Host ('  ' + (Get-Item (Join-Path $e2e 'content.js')).Length + ' B  ✓')

Write-Host ''
Write-Host '=== 2) node --check ===' -ForegroundColor Cyan
& node --check $src
if ($LASTEXITCODE -ne 0) { Write-Host '  ✗ 语法没过，下面不用跑了' -ForegroundColor Red; exit 1 }
Write-Host '  ✓'

$bad = 0
Write-Host ''
Write-Host '=== 3) 离线测试 ===' -ForegroundColor Cyan
foreach ($t in @('test_chunks.mjs', 'test_answer.mjs', 'test_bg_cache.mjs')) {
  Write-Host ''
  Write-Host "--- $t"
  $out = & node (Join-Path $here $t) 2>&1 | Out-String
  Write-Host $out.TrimEnd()
  if ($out -match '✗|×') { $bad++ }
}

if (-not $SkipBrowser) {
  Write-Host ''
  Write-Host '=== 4) devtest.html（Edge 无头） ===' -ForegroundColor Cyan
  $edge = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $edge) { Write-Host '  ✗ 没找到 msedge.exe，跳过' -ForegroundColor Red; $bad++ }
  else {
    $page = (New-Object System.Uri (Join-Path $e2e 'devtest.html')).AbsoluteUri
    $tmp  = Join-Path $env:TEMP ('edgedev_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $dom  = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir="$tmp" `
              --virtual-time-budget=$Budget --dump-dom "$page" 2>$null | Out-String
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    $m = [regex]::Match($dom, '(?s)<pre id="out">(.*?)</pre>')
    if (-not $m.Success) {
      Write-Host ('  ✗ 没抓到 #out（DOM ' + $dom.Length + ' 字节）') -ForegroundColor Red
      $bad++
    } else {
      $log = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
      Write-Host $log.TrimEnd()
      if ($log -match '✗') { $bad++ }
      if ($log -notmatch '完成') { Write-Host '  ⚠ 日志里没有「完成」——可能被 virtual-time 截断' -ForegroundColor Yellow }
    }

    Write-Host ''
    Write-Host '=== 5) 设置页（预设 / 保存 / 字段不丢） ===' -ForegroundColor Cyan
    & node (Join-Path $here 'make_options_test.mjs') | Out-Null
    $page2 = (New-Object System.Uri (Join-Path $e2e 'options_test.html')).AbsoluteUri
    $tmp2  = Join-Path $env:TEMP ('edgeopt_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $dom2  = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir="$tmp2" `
               --virtual-time-budget=$Budget --dump-dom "$page2" 2>$null | Out-String
    Remove-Item $tmp2 -Recurse -Force -ErrorAction SilentlyContinue
    $m2 = [regex]::Match($dom2, '(?s)<pre id="out"[^>]*>(.*?)</pre>')
    if (-not $m2.Success) {
      Write-Host ('  ✗ 没抓到 #out（DOM ' + $dom2.Length + ' 字节）') -ForegroundColor Red
      $bad++
    } else {
      $log2 = [System.Net.WebUtility]::HtmlDecode($m2.Groups[1].Value)
      Write-Host $log2.TrimEnd()
      if ($log2 -match '✗') { $bad++ }
      if ($log2 -notmatch '完成') { Write-Host '  ⚠ 日志里没有「完成」——设置页脚本可能没跑起来' -ForegroundColor Yellow; $bad++ }
    }
  }
}

Write-Host ''
Write-Host '=== 6) 打包 + 包完整性 ===' -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File (Join-Path $root 'build.ps1') | Out-Null
$packOut = & node (Join-Path $here 'check_packages.mjs') 2>&1 | Out-String
Write-Host $packOut.TrimEnd()
if ($packOut -match '✗|×') { $bad++ }

Write-Host ''
if ($bad -eq 0) { Write-Host '=== 全绿，可以打包了 ===' -ForegroundColor Green }
else { Write-Host "=== 有 $bad 处没过，别打包 ===" -ForegroundColor Red }
exit $bad
