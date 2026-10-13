# 旁译 · SideTrans

划词即译，**译文落在选区旁边**。一个纯前端的浏览器扩展：不弹窗、不切屏、不抢焦点，
翻译和取字都待在你正在看的那一页里。

它来自 [FlashTrans](https://github.com/chai1220/FlashTrans)（一个 Tauri 桌面程序）的交互想法：
FlashTrans 靠全局热键 + 置顶小窗，按下去浏览器会失焦；旁译把同一件事做进页面内部。

当前版本 **0.4.0**，只在 Firefox 上可用；Chrome / Edge 的适配还在做（见下方「浏览器支持」）。

---

## 功能

**划词这条线**

| 行为 | 说明 |
|---|---|
| 划词即译 | 选中文字，浮层出现在选区右侧；右边放不下自动翻到左边 |
| 中英自动互转 | 选中中文译成英文、选中英文译成中文，也可以固定方向 |
| 长文自动分段 | 按 500 字一段并发翻译，**按顺序**显示，进度写「已出 2/5 段」 |
| 三种模式 | **翻译**（正常译）／**做题**（只给答案，大字等宽）／**术语**（官方译法 + 备选 + 说明） |
| 做题可选解析 | 默认只给答案；随时点一下「看解析」，答案下面逐空说明为什么这么选 |
| 常用预设 | 默认 / 笔译风格 / 学术论文 / 技术文档 / 日常口语，选完还能自己改 |
| 译文风格 | 「日常」或「笔译赛」——后者按目标语言习惯重排句子，不逐词对应 |

**取字这条线（四条路，按顺序试）**

| 行为 | 说明 |
|---|---|
| 划词 | 拿到的是真文字，最准，优先用这个 |
| 双击图片 | 本地 OCR（Tesseract WASM，**没有外部进程、不联网**） |
| 工具栏图标 | 手动拖一个框，万能兜底 |
| 画上去的字 | 整道题渲染在 canvas 上、页面上选不中时，浮层会直接告诉你，并给一颗「取这块的字」 |

取字时浮层里会摊开三样：取到的那块预览、一行诊断（截图尺寸 / dpr / 裁切框 / 预处理）、
以及准确度。低于 50 会明说「只能当参考」。取错了你一眼能看见。

**界面**

- 浅色（暖白）／深色（暖黑）双主题，只换颜色，字号与按钮位置不变
- 结果显示在原文之前——眼睛先落到译文／答案上
- 浮层可拖动、Esc 关闭；关掉之后节点直接从页面里移除，页面脚本也摸不到它的内部（闭合 shadow DOM）

---

## 浏览器支持

| 浏览器 | 状态 | 说明 |
|---|---|---|
| **Firefox** 115+ | ✅ 可用 | MV2，后台常驻页，OCR 直接跑 |
| Chrome / Edge | ❌ 未适配 | 只收 MV3，而后台是 service worker：没有 DOM、不能用 Blob 建 Worker，现在的 OCR 那条路走不通。方案是用 `chrome.offscreen` 放一个离屏文档来跑 Tesseract，正在做 |

---

## 安装

### Firefox

Firefox 正式版强制校验扩展签名，所以自写的扩展有两条路：

**A. 临时载入（最快，重启浏览器后要重新载入）**

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点「临时载入附加组件…」
3. 选仓库根目录的 `manifest.json`

**B. 自签名（一次配置，之后永久生效）**

1. 到 <https://addons.mozilla.org/developers/> 注册并生成 API key / secret（免费）
2. 打包并提交未列出（unlisted）版本：

   ```powershell
   cd 旁译
   powershell -ExecutionPolicy Bypass -File .\sign.ps1 -ApiKey "user:xxxxx:123" -ApiSecret "xxxx"
   ```

3. 拿到的 `.xpi` 直接装，永久生效。

> 凭据不要写进任何文件。签名脚本只从参数读；`_ocr_dev/amo_get.mjs` 只从环境变量
> `AMO_KEY` / `AMO_SECRET` 或参数读——这个仓库里没有任何密钥。

---

## 翻译引擎

| 引擎 | 联网 | 需要 key | 说明 |
|---|---|---|---|
| 免费在线（MyMemory） | 要 | 不要 | 开箱即用；有速率限制，长句质量一般 |
| API（BYOK） | 要 | 要 | 任何 OpenAI 兼容接口（DeepSeek / Kimi / 硅基流动 / Ollama…），质量最好 |
| 本地服务 | 不要 | 不要 | 指向本机的翻译服务，全程离线 |

**本地服务接口约定**（想接离线模型，写个服务对上这个就行）：

```
POST http://127.0.0.1:8787/translate
Content-Type: application/json

{ "text": "...", "from": "en", "to": "zh-CN" }

→ { "text": "...", "engine": "可选" }
```

引擎出错时不会只丢一个状态码：余额不足、Key 失效、限流、连不上，各有各的说法。
「翻译」模式在主引擎挂掉时会自动退到免费引擎并**明确告诉你切换了**；
「做题 / 术语」没有免费替代，会如实报错——免费引擎做不了这两件事。

---

## 隐私

- **不收集任何数据**，没有埋点、没有账号、没有服务端。
- **OCR 全程在本机**：Tesseract 的 WASM 与语言模型都打包在扩展里，不联网、不启动外部进程。
- **API key 只存在你本机浏览器的扩展存储里**，不上传任何地方。
- 只有当你选择「免费在线」或「API」引擎时，被划中的那段文字才会发给你自己配置的那个接口。
  想全程不出本机，用「本地服务」引擎。
- 设置页有一个「导出诊断日志」：只记**哪一步、什么错、页面结构摘要**，不记你翻过的内容。

---

## 开发

```
旁译/
├─ manifest.json            Firefox 清单（MV2）
├─ manifest.chromium.json   Chromium 清单（MV3，适配中）
├─ background.js            语言判定 + 三个引擎 + OCR + 消息路由
├─ content.js               划词监听 + 阴影 DOM 浮层 + 写作框 + 取字
├─ options.html / options.js 设置页（引擎、方向、提示词、主题）
├─ icons/                   图标（16/32/48/96）
├─ build.ps1                打包
├─ sign.ps1                 打包 + 提交 AMO 签名
└─ _ocr_dev/                开发与自检（测试页、探针、自检脚本）
```

**构建**（会把 OCR 库从 `_ocr_dev/node_modules` 拷进产物）：

```powershell
cd _ocr_dev; npm i          # 只需一次：tesseract.js / tesseract.js-core / 语言模型
cd ..; powershell -ExecutionPolicy Bypass -File .\build.ps1
```

**自检**（改了 `content.js` 必须跑，它包含一个脱离浏览器环境的浮层驱动测试）：

```powershell
powershell -ExecutionPolicy Bypass -File .\_ocr_dev\selftest.ps1
```

五步：把 `content.js` 同步到 `_ocr_dev/e2e/` → `node --check` → 三个离线测试
（长文分段 / 做题输出解析 / 后台的缓存·降级·报错） → Edge 无头跑浮层四轮状态 → 设置页自检。

> ⚠️ `_ocr_dev/e2e/content.js` 是 `content.js` 的**拷贝**（测试页用相对路径引它）。
> 不先同步就跑自检，验的是旧文件。`selftest.ps1` 第一步就是做这件事。

---

## 已知限制

- 长文翻译依赖你配置的接口；免费引擎做不了「做题 / 术语」。
- 不翻译非文字内容（它会明说「这段看着不像正常文字」，不会硬编一个像样的译文）。
- 图片包在链接里时，单击会先扣 300ms 再跳转——那是为了给双击取字让路。

## Roadmap

- [ ] Chrome / Edge 适配：抽出一层「OCR 宿主」，Chrome 侧走 `chrome.offscreen`
- [ ] 上架 Edge Add-ons / Chrome Web Store
- [ ] 离线引擎：接一个本地小模型服务（NLLB / Opus-MT / GGUF）
- [ ] 快捷键触发（不自动译，按一下才译）

---

## 使用范围

扩展里带「做题」模式，本意是自用的学习与练习辅助。**请在你所在考试、竞赛或平台规则允许的范围内使用**；
把它用在明文禁止的场合，后果由使用者自负。

## 许可

[MIT](LICENSE)。构建产物里打包了 tesseract.js 与语言模型（均为 Apache-2.0），见 LICENSE 末尾的第三方说明。
