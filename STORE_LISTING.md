# 商店上架资料（三个商店共用）

> 上架包与素材由 `package.ps1` 生成到 `dist/`，完整性由 `_ocr_dev/check_packages.mjs` 核。
> 这份文档是**文案与审核说明**，不是代码。

## 基本信息

| 项 | 内容 |
|---|---|
| 名称 | 旁译 · SideTrans |
| 版本 | 0.4.0 |
| 类别 | 生产力工具 / 翻译 |
| 支持语言 | 简体中文（英文说明待补） |
| 许可 | MIT |

**一句话（CWS 的 summary 上限 132 字符）**

> 划词即译，译文落在选区旁边；双击图片本地取字；中英互转，还留一块地方让你写。不收集任何数据。

**详细描述**

> 旁译是一个**全在页面里**的翻译扩展：选中文字，译文浮层就出现在选区旁边，不弹窗、不切屏、不抢焦点。
>
> 三条线：
> - **翻译**：中英自动互转；长文自动分段并发翻译，按顺序显示（进度写「已出 2/5 段」）。
> - **做题**：只给答案，答案用等宽大字，一眼扫完；需要弄懂时点一下「看解析」，逐空说明为什么这么选。
> - **术语**：给官方译法（单独放大一行）、备选与说明，适合笔译场景。
>
> 字选不中也别急：**双击图片本地 OCR 取字**（Tesseract WASM，全程不出本机），或者点工具栏图标自己框一块。
> 取字时会把截图、诊断与准确度摊在浮层里，取错了你一眼能看见。
>
> 引擎三选：免费在线 / 任何 OpenAI 兼容接口（DeepSeek、Kimi、Ollama…）/ 指向本机的离线服务。
> 界面有浅色（暖白）与深色两套，只换颜色，字号与按钮位置不变。

## 权限说明（Chrome Web Store 要求逐条解释）

| 权限 | 为什么需要 |
|---|---|
| `storage` | 保存你的设置（引擎、方向、提示词、主题）。只在本机浏览器里 |
| `contextMenus` | 右键工具栏图标能弹出「旁译 · 设置」 |
| `offscreen` | Chrome/Edge 的 MV3 后台是 service worker，没有 DOM，**OCR（Tesseract WASM）必须放到离屏文档里才跑得起来** |
| `<all_urls>`（宿主） | 划词翻译要在任意页面上注入浮层，这是它唯一的用途；「双击取字」还要用 `captureVisibleTab` 截当前视口 |
| `api.mymemory.translated.net`（宿主） | 「免费在线」引擎的接口地址，只有你选它时才会请求 |

## 隐私声明（商店的「数据使用」一栏应勾选：不收集）

- **不收集、不传输、不存储任何用户数据**：没有账号、没有埋点、没有服务端。
- **OCR 全程在本机**：Tesseract 的 WASM 与中英文模型都打包在扩展里，不联网、不起外部进程。
- **只有你主动选「免费在线」或「API」引擎时**，被划中的那段文字才会发往你自己配置的那个接口。想全程不出本机，用「本地服务」引擎。
- **API key 只存在浏览器本地存储里**，不上传任何地方。
- 设置页的「导出诊断日志」只记**哪一步、什么错、页面结构摘要**，不记你翻过的内容。

## 给审核员的备注（AMO 需要，其他商店可选填）

- 包内的 `tesseract.min.js`、`worker.min.js`、`tesseract-core-simd-lstm.wasm(.js)`、`lang/*.traineddata.gz`
  是**第三方库与模型**：tesseract.js 与 tesseract.js-core（Apache-2.0）、@tesseract.js-data（Apache-2.0）。
  上游源码：<https://github.com/naptha/tesseract.js>、<https://github.com/naptha/tessdata>。
  构建时由 npm 安装后拷入产物，**本仓库不含它们的源码**。
- 本扩展自身的代码**未压缩、未混淆**。
- 可复现构建见 README 的「开发」一节；`_ocr_dev/selftest.ps1` 是自检脚本。

## 素材清单

| 文件 | 用途 |
|---|---|
| `dist/store/icon-128.png` | 商店列表图标（128×128） |
| `dist/store/icon-300.png` | Edge 列表要求的方形 logo（300×300） |
| `dist/store/screenshots/01-划词翻译.png` | 截图（1280×800） |
| `dist/store/screenshots/02-做题带解析.png` | 截图（1280×800） |
| `dist/store/screenshots/03-取字.png` | 截图（1280×800） |
| `dist/sidtrans-0.4.0-chromium-mv3.zip` | **Edge 与 Chrome 共用**这一份 |
| `dist/sidtrans-0.4.0-firefox-mv2.zip` | AMO 用 |

## 各店注意

- **Chrome Web Store**：需要一次性 5 美元的开发者注册费；审核会看权限解释；「单一用途」填「翻译」。
- **Edge Add-ons**：免费，用微软账号；要 300×300 logo；收同一个 MV3 zip。
- **AMO**：账号已有（unlisted 签名走 `sign.ps1`）。改**公开上架（listed）**会有人工审核，注意上面那段第三方代码说明。
