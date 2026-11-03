# 发布规范

发布目标仅为 `Gogowu/fly-island-custom`，不能向上游发布衍生安装包。

1. 同步 package.json、Cargo.toml 和 tauri.conf.json 版本，编写 `docs/releases/v版本.md`。
2. 核对来源、许可证和个人信息，不发布账号缓存、密钥、配置备份或私人模型地址。公开快照的来源见 `PROVENANCE.md`。
3. 锁定安装依赖，执行 `node --test tests/*.test.mjs` 和 `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`。常规发布不运行需真实账号的忽略测试。
4. 退出正在运行的 release 程序，执行 `pnpm release --no-upload`，收集许可证、完整构建 EXE / MSI，生成法律声明压缩包和 SHA-256 文件，输出 `release-artifacts/v版本/`。
5. 检查 EXE、MSI 版本及文件表、许可证资源和校验值，完成启动检查。成功构建后同步桌面快捷方式。
6. 提交相关源码，推送与产物匹配的版本提交，创建 `v版本` 标签。新公开仓库使用清理后的快照，保留署名和来源。
7. 对该标签创建 Release 草稿，上传两种安装包、法律声明压缩包及 SHA256SUMS.txt，填写发行说明，核对上传成功与大小后发布为 Latest。不得覆盖已发布版本，修订须升级版本。

本版无 Authenticode 证书，未配置自动更新公钥。发行说明明确未知发布者和手动更新；不生成伪造的签名或 latest.json。原签名辅助脚本保留供未来独立配置密钥使用，默认仓库已改为本项目。
