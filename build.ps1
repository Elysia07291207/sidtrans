# 旁译 · SideTrans —— 打包脚本
# 用法： powershell -ExecutionPolicy Bypass -File .\build.ps1
# 产物：
#   _build\unpacked-firefox\       Firefox 打包源目录（含 OCR 库）
#   _build\sidtrans@pangyi.local.xpi   未签名 xpi（仅供临时载入）
#   _build\unpacked-chromium\      Chromium 解压目录
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

# ---------- Firefox ----------
foreach ($f in $shared) { Copy-Item (Join-Path $root $f) $ff -Force }
Copy-Item (Join-Path $root "manifest.json") (Join-Path $ff "manifest.json") -Force

# 图标：manifest 里引用了，漏拷会让浏览器直接报「找不到文件」
$icoSrc = Join-Path $root "icons"
if (Test-Path $icoSrc) {
  $icoDst = Join-Path $ff "icons"
  New-Item -ItemType Directory -Force -Path $icoDst | Out-Null
  Copy-Item (Join-Path $icoSrc "*.png") $icoDst -Force
} else {
  Write-Host "!! 缺 icons\ 目录 —— manifest 里引用了图标，先跑： cd _ocr_dev; node make_app_icon.mjs"
}

if (Test-Path $lib) {
  $lang = Join-Path $ff "lang"
  New-Item -ItemType Directory -Force -Path $lang | Out-Null
  Copy-Item (Join-Path $lib "tesseract.js\dist\tesseract.min.js") $ff -Force
  Copy-Item (Join-Path $lib "tesseract.js\dist\worker.min.js") $ff -Force
  Copy-Item (Join-Path $lib "tesseract.js-core\tesseract-core-simd-lstm.wasm.js") $ff -Force
  Copy-Item (Join-Path $lib "tesseract.js-core\tesseract-core-simd-lstm.wasm") $ff -Force
  Copy-Item (Join-Path $lib "@tesseract.js-data\chi_sim\4.0.0_best_int\chi_sim.traineddata.gz") $lang -Force
  Copy-Item (Join-Path $lib "@tesseract.js-data\eng\4.0.0_best_int\eng.traineddata.gz") $lang -Force
} else {
  Write-Host "!! 找不到 $lib —— OCR 库没装，先跑： cd _ocr_dev; npm i tesseract.js@7 tesseract.js-core@6 '@tesseract.js-data/chi_sim' '@tesseract.js-data/eng'"
}

$zip = Join-Path $build "ff.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $ff "*") -DestinationPath $zip -Force
Move-Item $zip (Join-Path $build "sidtrans@pangyi.local.xpi") -Force

# ---------- Chromium（暂不含 OCR） ----------
foreach ($f in $shared) { Copy-Item (Join-Path $root $f) $cr -Force }
Copy-Item (Join-Path $root "manifest.chromium.json") (Join-Path $cr "manifest.json") -Force
$cz = Join-Path $build "pangyi-chromium.zip"
if (Test-Path $cz) { Remove-Item $cz -Force }
Compress-Archive -Path (Join-Path $cr "*") -DestinationPath $cz -Force

Write-Host "OK"
$total = (Get-ChildItem $ff -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("Firefox 包体积: {0} MB" -f [math]::Round($total / 1MB, 1))
Get-ChildItem $build -File | Select-Object Name, Length | Format-Table -AutoSize
