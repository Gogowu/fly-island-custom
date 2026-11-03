# Fly Island Custom

[English](README.en.md) · 中文

面向 Windows 的悬浮岛效率工具，基于 [flyl1u/fly-island](https://github.com/flyl1u/fly-island) 修改，由 Gogowu 独立维护和发布。非原项目官方发布，也不代表任何 AI 服务商。

[下载安装包](https://github.com/Gogowu/fly-island-custom/releases/latest) · [反馈问题](https://github.com/Gogowu/fly-island-custom/issues) · [原项目](https://github.com/flyl1u/fly-island)

## 本版变更

- CPU、逻辑处理器、内存、GPU、网速及进程排行。GPU 使用实际显卡名称和设备标识，不使用容易与任务管理器混淆的自定义编号。
- 可分别开启 Codex、Claude 订阅额度，或全部关闭；默认开启 Codex。
- 保留 DeepSeek 翻译，增加自定义 OpenAI 兼容服务、模型及密钥，支持无密钥本机服务，以及手动启用的局域网 HTTP 服务。
- 移除原项目检查更新、Star、最新版本入口。本版从本仓库 Release 手动更新。

保留原项目的待办、每日笔记、剪贴板、媒体控制、消息提醒和外观设置。详细配置见 [功能说明](docs/monitoring-and-translation.md)。性能/额度设计参考 [BrimDeck](https://github.com/MoFeng2223/BrimDeck)，在 Rust / React 中适配实现。

## 安装与使用

Windows 10 / 11 x64，需要 Microsoft Edge WebView2 Runtime。下载 Release 的 `*-setup.exe` 双击安装；需要 MSI 部署时用 `.msi`，二选一即可。发布包未使用 Authenticode 代码签名，Windows 可能显示未知发布者。可用 `SHA256SUMS.txt` 核对下载文件。

本版沿用原应用标识以兼容已有数据，请避免与原版同时安装或运行。升级前备份重要笔记和配置，卸载前自行保存需要的内容。

自建模型：选择自定义翻译服务，填写模型 ID 和 Base URL（例如 `http://192.168.1.2:11434/v1`），私有局域网 HTTP 需要启用相应开关，可不填 API Key。公网服务必须使用 HTTPS；服务需支持 Chat Completions 协议。

## 隐私与限制

- 翻译将输入发送至所选服务，费用由服务商计算；密钥保存在 Windows 凭据管理器。
- 额度功能读取本机 Codex / Claude Code 登录信息，仅向各自额度端点请求，不上传对话、不修改或刷新其他软件登录。Claude 桌面版加密凭据不支持。
- 额度接口不是稳定公开 API，可能失效；不提供本地 Token / 费用估算。真实 Claude 账号查询尚未验证。
- GPU 取决于 Windows 性能计数器和驱动；无有效数据时显示暂无读数。网卡汇总可能重复统计虚拟接口流量。
- 剪贴板、邮件和通知等原有功能可能处理敏感本机内容，请按需要开启。发布文件不包含维护者凭据、API Key 或私人模型地址。

## 开发与发布

需要 Node.js、pnpm、Rust stable、Visual Studio C++ Build Tools 和 Windows SDK。

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1
pnpm release --no-upload
```

发布命令生成许可证清单、完整构建 EXE / MSI，并准备发布文件及校验文件；不启用自动更新签名。见 [发布规范](docs/RELEASING.md)。

## 来源与许可证

原项目 copyright 和 MIT 全文保留在 [LICENSE](LICENSE)。本版由 Gogowu 维护；参考适配 BrimDeck 的监测/额度部分按 Apache-2.0 条件提供，保留 ftop MIT 署名。字体为 SIL OFL-1.1，品牌图标归相应权利人。详见 [第三方声明](THIRD_PARTY_NOTICES.md) 和 [licenses](licenses)，许可证随安装包分发。

公开仓库使用清理后的源码快照创建新历史，保留 [来源记录](docs/PROVENANCE.md)，不冒充原项目作者。
