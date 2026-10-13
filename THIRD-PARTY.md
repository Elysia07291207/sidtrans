# 第三方组件与来源说明

## 灵感与来源

旁译的**交互想法**来自 [FlashTrans](https://github.com/chai1220/FlashTrans)（chai1220，MIT 许可）——
一个 Tauri + Rust 写的桌面翻译程序：划词、浮层落在选区旁边、不打断手上的事。

FlashTrans 是**桌面程序**，靠全局热键 + 置顶小窗，按下去浏览器会失焦。
旁译把同一件事搬进了浏览器内部（页面内浮层，不产生第二个窗口），
并在它之上做了长文分段、三种模式（翻译 / 做题 / 术语）、本地 OCR 取字、
双主题等扩展。**本仓库不含 FlashTrans 的代码**，是照着它的交互重新实现的；
它的 MIT 许可允许这样使用，我们在此明确致谢。

## 构建产物里打包的第三方组件

本项目的**源码**不含第三方代码；`build.ps1` / `package.ps1` 生成的产物（xpi / zip）
会打包下面这些，它们各自遵循自己的许可证：

| 组件 | 许可证 | 用途 |
|---|---|---|
| [tesseract.js](https://github.com/naptha/tesseract.js) | Apache-2.0 | 本地 OCR 引擎（WASM） |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | Apache-2.0 | wasm 内核 |
| [@tesseract.js-data/chi_sim, eng](https://github.com/naptha/tessdata) | Apache-2.0 | 中英文识别模型 |

它们由 npm 安装后从 `_ocr_dev/node_modules` 拷入产物，不随源码仓库分发。
在 AMO 上架需要提交源码时，可引用上面的上游仓库地址（本扩展自身代码未压缩、未混淆）。
