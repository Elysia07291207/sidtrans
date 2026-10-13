# 旁译 · SideTrans —— 出「商店上架包」
#
# 三个商店收的东西其实是两种包：
#   · Firefox（AMO）        → MV2 那份（unlisted 签名已经在 sign.ps1 里做了；这里只是给上架用的 zip）
#   · Edge Add-ons / Chrome Web Store → MV3 那份，**同一个 zip 两边都能用**
# 所以这里出两个 zip + 一份商店素材，分别命名清楚。
#
# 用法： powershell -ExecutionPolicy Bypass -File .\package.ps1
# 产物： dist\sidtrans-<版本>-firefox-mv2.zip
#        dist\sidtrans-<版本>-chromium-mv3.zip
#        dist\store\  （128 商店图标、300 方形 logo、截图）

param([switch]$SkipBuild)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dist = Join-Path $root "dist"

if (-not $SkipBuild) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $root "build.ps1") | Out-Null
}

$ff = Join-Path $root "_build\unpacked-firefox"
$cr = Join-Path $root "_build\unpacked-chromium"
foreach ($d in @($ff, $cr)) {
  if (-not (Test-Path $d)) { throw "缺 $d —— 先跑 build.ps1" }
}

# 版本号从 manifest 里读（两个 manifest 必须一致，check_packages.mjs 会核）
$ver = ((Get-Content (Join-Path $root "manifest.json") -Raw) -split '"version"\s*:\s*"')[1].Split('"')[0]
Write-Host "版本: $ver"

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dist | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dist "store") | Out-Null

# ⚠️ 商店都要求 zip 的**根目录**就是 manifest.json（不能套一层文件夹），
#    所以这里用 <目录>\* 而不是整个目录。
Compress-Archive -Path (Join-Path $ff "*") -DestinationPath (Join-Path $dist "sidtrans-$ver-firefox-mv2.zip") -Force
Compress-Archive -Path (Join-Path $cr "*") -DestinationPath (Join-Path $dist "sidtrans-$ver-chromium-mv3.zip") -Force

# 商店素材：图标
foreach ($n in @("icon-128.png", "icon-300.png")) {
  $src = Join-Path $root "icons\$n"
  if (Test-Path $src) { Copy-Item $src (Join-Path $dist "store\$n") -Force }
  else { Write-Host "!! 缺 icons\$n —— 先跑： cd _ocr_dev; node make_app_icon.mjs" }
}

# 商店素材：截图（1280×800）
$shots = Join-Path $dist "store\screenshots"
New-Item -ItemType Directory -Force -Path $shots | Out-Null
& node (Join-Path $root "_ocr_dev\make_store_shots.mjs") $shots 2>&1 | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Get-ChildItem $dist -Recurse -File | Select-Object @{n='大小KB';e={[math]::Round($_.Length/1KB,1)}}, FullName | Format-Table -AutoSize
