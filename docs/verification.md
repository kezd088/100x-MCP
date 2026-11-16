# 验证记录

## 0.3.4 · Windows 受限语言模式下保存凭据

问题：PowerShell 处在受限语言模式（AppLocker、WDAC）时，客户端起的 PowerShell 改控制台编码、用 `[Console]::In` 读输入、用 `Marshal` 解出明文、用 .NET 的 ACL 类型收紧权限，这几步都被拦。凭据存不了，就不回执给网站。DPAPI 加密本身用的就是 `ConvertFrom-SecureString`，密文格式这次不变。

2026-11-16 在 Mac 上实际跑过：

- `node --test tests/*.test.mjs`：27 项通过，4 项只在 Windows 或装了 PowerShell 时跑，跳过。
- 容器里的 PowerShell 7.5 切到受限语言模式：旧版这四处写法都报「only core types」，旧 `install.ps1` 停在第 4 行；新的加解密脚本往返通过（含中文和 emoji）；`install.ps1` 用替身 codex、node 走完 `-Connect`；受限模式那条安装命令在两种模式下、脚本带不带 BOM 都能跑。同一容器装上 Node 跑 `tests/client.test.mjs`：10 项通过，3 项只在 Windows 跑。
- Codex CLI 0.169 用隔离的 `CODEX_HOME`：本地源从 0.3.3 重跑安装器装成 0.3.4，插件缓存按版本分目录。

2026-11-16 在 Windows 11（PowerShell 5.1.26100，Codex CLI 0.162）上用测试账号连正式站验收，四条都过：

- 0.3.3 升级：先装 0.3.3 并连上，再装成 0.3.4，不重新连接，stdio 桥列出 19 个型号和余额；之后切到受限模式，同一份旧凭据照样能读。
- 受限模式：系统级 `__PSLockdownPolicy=4`，新起的 PowerShell 显示 `ConstrainedLanguage`。用文档里受限模式那条命令安装并 `-Connect`，网页允许后本机保存成功，网页显示「已授权」，stdio 桥查到型号和余额。
- 普通模式：0.3.4 全新 `-Connect` 照样走通。
- 凭据文件：`protection` 为 `windows-dpapi`，密文是 DPAPI 格式；DACL 不继承，只有当前用户和 SYSTEM 两条完全控制。
- `tests/client.test.mjs`：普通模式下 Windows 专属的 4 项全过；系统级受限模式下 12 过、0.3.3 那项按设计跳过。`tests/install-sh.test.mjs` 在这台 Windows 上 6 项失败，0.3.3 上同样失败，与这次改动无关。

受限模式下 PowerShell 优先跑 `codex.ps1` 外壳；这台机器的 codex 包装脚本在受限模式下跑不起来，验收时把 npm 装的 codex 放在 PATH 前面。npm 生成的外壳只有比较、`Test-Path` 和调用 node，受限模式下能跑。Codex 桌面端那一步用同一个 stdio 桥直接调工具代替。

## 0.3.1 · macOS 授权向导（代码路径已验，真机待验收）

2026-09-22 晚，在 Windows 机器上完成 macOS 代码路径的验证。**没有真实 macOS 设备参与，这一节不构成 macOS 验收。**

已实际跑过并全绿：

- 客户端 26 项测试通过（`node --test tests/*.test.mjs`）。其中 Windows 原有 12 项无回归，含真实 DPAPI 往返；新增 macOS 8 项、`install.sh` 6 项。
- macOS 钥匙串用受控替身（`tests/support/security-stub.mjs`）验证：令牌与其 base64 都不出现在进程参数里（只走标准输入）、配置文件里只有条目引用、写入必须带 `-T /usr/bin/security`、待授权数据与令牌是两条互不覆盖的条目、`Codex · macOS` 设备名进入授权请求。
- 失败分支钉住：钥匙串写入没存住报 `100X_SAVE_FAILED` 而不是当成已连接、条目缺失或内容损坏报 `100X_CREDENTIAL_UNREADABLE`、Windows 写的配置在 macOS 上报 `100X_INVALID_CONFIG`、Linux 等平台报 `100X_CONFIG_PLATFORM` 且不退回明文保存。
- `install.sh` 用替身 codex 与隔离的 `CODEX_HOME` 跑过 6 条分支：正常安装、`--connect`、来源不是 100x 目录、Codex 版本过低、插件未启用、未知参数，退出码与提示均符合预期。

尚未覆盖，需在真实 macOS 上完成：

- 真实 `/usr/bin/security` 的行为，尤其首次读取是否弹出钥匙串授权框。
- Codex Desktop for Mac 的插件加载、9 个工具与 `100x:100x-creative` 是否出现在新任务中。
- 从 GitHub 拉取 `install.sh` 的完整安装、真实网页授权、真实生成与产物下载。
- Dock 启动时 PATH 不含 Homebrew node 的情况是否真的发生（安装器已加提示，未在真机复现过）。

## 0.3.0 · 设备授权

2026-09-22，使用 Windows、隔离的本机 PostgreSQL、真实 DPAPI 存储与源码 stdio 桥接完成验证。升级安装后需在 Codex 新建任务加载新增工具。

- 28 项接口与客户端集成检查通过：账户登录、CSRF、授权幂等、跨账户隔离、保存回执、素材上传、原计费报价、预算限制、生成去重、撤销立即失效等。
- 14 项浏览器检查通过：登录返回授权页、网页允许 → stdio 客户端加密保存 → 回执 → 网页连接成功，以及设备撤销、320 / 390 px 布局、两行状态、断网、焦点与减少动态效果。
- 12 项客户端测试通过，包含断网不重复授权、拒绝与过期状态、保存回执丢失后恢复。源码语法检查通过。
- 生成检查实际提交并取消本机队列任务，恢复预留测试积分，没有请求真实模型。下载失败与重试使用受控 HTTP 响应。

后端与前端干净构建通过。发布候选已通过真实 GPT 1K 图片与 H3 480P、5 秒视频生成，分别消耗 2 和 4 积分；图片返回 100x 下载地址并成功读取，视频产物已就绪。一次测试隧道断连后按原任务恢复查询，没有重复生成。Grok 视频本轮未实测。

项目全量门禁仍有基线已有的创意区选择器和 CSS 边界失败，已在未修改的基线上复现。未修改用户默认的 Codex 插件配置；当前 GUI 对话体验和 macOS / Linux 加密授权向导仍待用户验收。

客户端复验：`pnpm test`、`pnpm check`。完整的本机集成脚本位于服务端仓库的 `tests/backend/mcp-authorization/`。

## 0.2.0 历史验证

2026-09-22，在 Windows 上使用 Codex Desktop app-server 0.155.1 验证。

- 在隔离的 Codex 配置中运行安装脚本，原生插件安装成功，启用状态可回读。
- 桌面端运行时识别 `100x@100x`，加载 8 个 MCP 工具和 `100x:100x-creative` SKILL。
- 通过同一运行时调用实际 100x 账户，完成型号查询、余额查询、报价、图片生成、任务查询，并通过随包脚本保存结果。
- 本次 1K 图片示例报价 2 积分。提交请求约 0.52 秒返回任务号，从开始连接、报价到图片完成约 66 秒；这是一次实测，不是速度承诺，也不代表公示价格已启用。
- 8 项客户端测试通过，覆盖未连接、错误凭据、Windows DPAPI 保存与再次连接、重定向拒绝、请求超时不自动重试、参数传递和下载防覆盖。

实测产物见 [示例图](../assets/readme/100x-generated-cube.jpg)。

历史验证边界：以上是 0.2.0 的安装和桌面端运行时记录，当时尚未开放公共远程服务，也未重新消耗视频生成积分。公开仓库本身不附带账户或额度。

开发者运行 `node --test tests/client.test.mjs` 可复验不消耗生成积分的客户端测试。真实账户验证涉及个人凭据，测试记录与服务配置不在公开仓库中。
