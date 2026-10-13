# 三个商店的上架步骤（照着点就行）

> 包和素材都在 `dist/`，文案在 `STORE_LISTING.md`。这一份只说「点哪里、填什么、传哪个文件」。
> 六个包都由 `package.ps1` 生成，`_ocr_dev/check_packages.mjs` 已核过（根目录有 manifest、图标尺寸、截图 1280×800）。

---

## 一、Chrome Web Store（要 5 美元，一次性）

1. 打开 <https://chrome.google.com/webstore/devconsole>，用 Google 账号登录。
2. 首次会让你付 **5 美元**开发者注册费（一次性，不年费）。
3. 点「新增项目」→ 上传 **`dist/sidtrans-0.4.0-chromium-mv3.zip`**。
4. 上传后它会自动读 manifest。填这些：
   - **名称**：旁译 · SideTrans
   - **摘要**：`STORE_LISTING.md` 里「一句话」那一行（≤132 字符，直接复制）
   - **类别**：生产力工具 → 翻译
   - **语言**：简体中文
   - **详细说明**：`STORE_LISTING.md` 里「详细描述」整段，直接粘贴
   - **商店图标**：`dist/store/icon-128.png`
   - **截图**：`dist/store/screenshots/` 三张（1280×800，正好是它要的尺寸）
5. **隐私**标签页：
   - 「单一用途」填：**翻译**（一句话说明：在页面上划词翻译，并支持本地 OCR 取字）
   - 权限理由：`STORE_LISTING.md` 的「权限说明」表格，逐条抄
   - 数据使用：勾 **不收集任何用户数据**（三项都不用勾）
   - 隐私政策网址：可以填 GitHub 仓库地址（`https://github.com/Elysia07291207/sidtrans`）
6. 提交审核。CWS 审核通常 **1–3 个工作日**，被拒它会给出具体条目，照着改再提。

---

## 二、Edge Add-ons（免费）

1. 打开 <https://partner.microsoft.com/dashboard/microsoftedge/>，用微软账号登录（免费）。
2. 「创建新扩展」→ 上传 **同一个 zip**：`dist/sidtrans-0.4.0-chromium-mv3.zip`。
3. 填资料（跟 CWS 差不多）：
   - **名称 / 描述**：同上，文案直接用 `STORE_LISTING.md`
   - **Logo**：`dist/store/icon-300.png`（它专门要 300×300，这个尺寸别的店不要）
   - **截图**：同三张
   - **属性**：分类选「生产力」→「翻译」
   - **权限说明 / 隐私**：同 `STORE_LISTING.md`
4. 提交。Edge 审核一般比 Chrome 快。

> Edge 与 Chrome 收的是**同一个 MV3 包**，所以只传一次包，两处都传同一个文件。

---

## 三、AMO（Firefox，账号已有）

现在的状态：**unlisted（未列出）**，已经能装、能签名——`sign.ps1` 一条命令出包。
要变成**公开可搜（listed）**，走后台：

1. 打开 <https://addons.mozilla.org/zh-CN/developers/addons/>，找到「旁译 · SideTrans」。
2. 点 **编辑产品页（Edit Product Page）**，填：
   - **名称**：旁译 · SideTrans
   - **摘要**：`STORE_LISTING.md` 里「一句话」
   - **描述**：`STORE_LISTING.md` 里「详细描述」
   - **类别**：其他 → 语言支持；**标签**：翻译 / 划词 / OCR
   - **截图**：三张 1280×800（AMO 也收这个尺寸）
   - **许可**：MIT（在「License」一栏选 MIT，或填仓库地址）
   - **隐私政策**：`STORE_LISTING.md` 的「隐私声明」，或指向仓库
3. 保存产品页后，在「版本」页提交新版本，**channel 选 listed**。
   - 如果它有「提交源码」的要求：`STORE_LISTING.md` 里「给审核员的备注」那段就是给它的
     （tesseract.js 是第三方库，上游仓库地址已写明；本扩展自身代码未压缩）。
4. listed 版本会进**人工审核**，几天到两周不等；审核会看权限与隐私说明。

> 也可以让我用 API 直接试一次 listed 提交（我有凭据）。但产品页没填的话大概率被打回，
> 而且这一步会把插件从「未列出」变成「公开待审」——**这个状态变化得你点头**。

---

## 上架之后还该做的两件

1. **在真窗口里手点一次**（Firefox 与 Edge 各一次）：划词、双击取字、做题、术语。
   自动化只能证明代码路径通，证不了真机手感。
2. **把 GitHub 的 README 补一句商店链接**（上架成功后再补，不然是死链）。
