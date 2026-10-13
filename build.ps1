# 旁译 · SideTrans —— 打包脚本
# 用法： powershell -ExecutionPolicy Bypass -File .\build.ps1
# 产物：
#   _build\unpacked-firefox\            Firefox 打包源目录（MV2）
#   _build\sidtrans@pangyi.local.xpi    未签名 xpi（仅供临时载入）
#   _build\unpacked-chromium\           Chromium 源目录（MV3，含离屏 OCR）
#   _build\pangyi-chromium.zip

$ErrorActionPreference = "Stop"
$root  = $PSScriptRoot
$build = Join-Path $root "_build"
$ff    = Join-Path $build "unpacked-firefox"
$cr    = Join-Path $build "unpacked-chromium"
$lib   = Join-Path $root "_ocr_dev\node_modules"

foreach ($d in @($ff, $cr)) {
  if (Test-Path $d) { Remove-Item $d -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}

$shared = @("background.js", "content.js", "options.html", "options.js")

# OCR 的三件套 + 两个语言模型。两个浏览器都要：Firefox 在后台常驻页跑，
# Chromium 在离屏文档里跑（offscreen.html + offscreen.js）。
function Copy-OcrLibs($dest) {
  if (-not (Test-Path $lib)) { return $false }
  $lang = Join-Path $dest "lang"
  New-Item -ItemType Directory -Force -Path $lang | Out-Null
  Copy-Item (Join-Path $lib "tesseract.js\dist\tesseract.min.js") $dest -Force
  Copy-Item (Join-Path $lib "tesseract.js\dist\worker.min.js") $dest -Force
  Copy-Item (Join-Path $lib "tesseract.js-core\tesseract-core-simd-lstm.wasm.js") $dest -Force
  Copy-Item (Join-Path $lib "tesseract.js-core\tesseract-core-simd-lstm.wasm") $dest -Force
  Copy-Item (Join-Path $lib "@tesseract.js-data\chi_sim\4.0.0_best_int\chi_sim.traineddata.gz") $lang -Force
  Copy-Item (Join-Path $lib "@tesseract.js-data\eng\4.0.0_best_int\eng.traineddata.gz") $lang -Force
  return $true
}

# 图标：manifest 里引用了，漏拷会让浏览器直接报「找不到文件」
function Copy-Icons($dest) {
  $icoSrc = Join-Path $root "icons"
  if (-not (Test-Path $icoSrc)) {
    Write-Host "!! 缺 icons\ 目录 —— manifest 里引用了图标，先跑： cd _ocr_dev; node make_app_icon.mjs"
    return
  }
  $icoDst = Join-Path $dest "icons"
  New-Item -ItemType Directory -Force -Path $icoDst | Out-Null
  Copy-Item (Join-Path $icoSrc "*.png") $icoDst -Force
}

# ---------- Firefox（MV2） ----------
foreach ($f in $shared) { Copy-Item (Join-Path $root $f) $ff -Force }
Copy-Item (Join-Path $root "manifest.json") (Join-Path $ff "manifest.json") -Force
Copy-Icons $ff
if (-not (Copy-OcrLibs $ff)) {
  Write-Host "!! 找不到 $lib —— OCR 库没装，先跑： cd _ocr_dev; npm i"
}

$zip = Join-Path $build "ff.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $ff "*") -DestinationPath $zip -Force
Move-Item $zip (Join-Path $build "sidtrans@pangyi.local.xpi") -Force

# ---------- Chromium / Edge（MV3） ----------
foreach ($f in $shared) { Copy-Item (Join-Path $root $f) $cr -Force }
Copy-Item (Join-Path $root "manifest.chromium.json") (Join-Path $cr "manifest.json") -Force
# MV3 的后台是 service worker：没有 DOM、不能建 Blob Worker，OCR 要放离屏文档
foreach ($f in @("offscreen.html", "offscreen.js")) { Copy-Item (Join-Path $root $f) $cr -Force }
Copy-Icons $cr
if (-not (Copy-OcrLibs $cr)) {
  Write-Host "!! 找不到 $lib —— Chromium 侧的离屏 OCR 也会缺文件"
}

$cz = Join-Path $build "pangyi-chromium.zip"
if (Test-Path $cz) { Remove-Item $cz -Force }
Compress-Archive -Path (Join-Path $cr "*") -DestinationPath $cz -Force

Write-Host "OK"
$total = (Get-ChildItem $ff -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("Firefox 包体积: {0} MB" -f [math]::Round($total / 1MB, 1))
$total2 = (Get-ChildItem $cr -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("Chromium 包体积: {0} MB" -f [math]::Round($total2 / 1MB, 1))
Get-ChildItem $build -File | Select-Object Name, Length | Format-Table -AutoSize
