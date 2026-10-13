param(
  [Parameter(Mandatory = $true)][string]$ApiKey,
  [Parameter(Mandatory = $true)][string]$ApiSecret,
  [switch]$SkipInstall
)

# 旁译 · SideTrans —— 用 AMO 给扩展签名
# API key / secret 在这里生成： https://addons.mozilla.org/developers/addon/api/key/
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\sign.ps1 -ApiKey "user:xxxxx:123" -ApiSecret "xxxxx"

$ErrorActionPreference = "Stop"
$root  = $PSScriptRoot
$build = Join-Path $root "_build"
$stage = Join-Path $build "unpacked-firefox"
$art   = Join-Path $build "signed"
$guid  = "sidtrans@pangyi.local"

# 先打包（会重建 unpacked-firefox，含 OCR 库）
& (Join-Path $root "build.ps1") | Out-Null

if (Test-Path $art) { Remove-Item $art -Recurse -Force }
New-Item -ItemType Directory -Force -Path $art | Out-Null

Write-Host "== 提交签名（channel=unlisted，不会公开上架）=="
web-ext sign `
  --api-key $ApiKey `
  --api-secret $ApiSecret `
  --source-dir $stage `
  --channel unlisted `
  --artifacts-dir $art `
  --no-input

$xpi = Get-ChildItem $art -Filter *.xpi -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $xpi) {
  Write-Host "!! web-ext 没拿到签名包（常见：轮询超时）。用 API 直接取："
  Write-Host "   接口能取到时会把文件放到 $art"
  throw "签名没产出 xpi。"
}
Write-Host "== 签名完成: $($xpi.FullName)  ($([math]::Round($xpi.Length/1KB,1)) KB)"

if (-not $SkipInstall) {
  $profiles = Join-Path $env:APPDATA "Mozilla\Firefox\Profiles"
  $prof = Get-ChildItem $profiles -Directory | Where-Object { Test-Path (Join-Path $_.FullName "prefs.js") } | Select-Object -First 1
  if (-not $prof) { throw "没找到 Firefox profile。" }
  $extDir = Join-Path $prof.FullName "extensions"
  New-Item -ItemType Directory -Force -Path $extDir | Out-Null
  $dest = Join-Path $extDir "$guid.xpi"
  Get-Process firefox -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
  Copy-Item $xpi.FullName $dest -Force
  Write-Host "== 已装进 profile: $dest"
  Write-Host "== 打开 Firefox 后，扩展是永久生效的（签名版）。"
}
