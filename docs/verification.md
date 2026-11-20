# 验证记录

## 0.3.7 · 连接和 Codex 一样顺

改动：
- `100x_connect` 自己用系统浏览器打开授权页，返回 `browser_opened`。以前只有安装器 `--connect` 会开，聊天里要用户自己点链接。
- `100x_connection_status` 在授权进行中最多等 25 秒，用户点了允许就返回 `connected`，Claude 不用等用户回话。
- 扩展包带上 SKILL。桥接把 SKILL 正文作为 MCP `instructions` 发给宿主，Claude 桌面端没有 skill 机制，现在也知道怎么连、怎么报价和生成。SKILL 是唯一来源。

2026-11-20 在 Mac 上实际跑过：

- `node --test tests/*.test.mjs`：52 项通过，4 项跳过。新加的测试：自动打开浏览器、续用同一请求时再打开、打开失败（同步抛错或异步报错）时返回 `browser_opened: false`、只把 http(s) 授权页交给浏览器、等待期间批准就返回 connected、到时限返回 waiting、慢请求不拉长等待、两次轮询间隔不短于服务端要求（从上次回包算起，保存失败的重试也算）、重启后恢复的请求先等一个间隔、过期结果不被本地清理失败覆盖、后台连上后状态调用 250 毫秒内返回、打开浏览器期间请求结束也返回链接和核对码、`instructions` 等于 SKILL 正文。
- `mcpb validate` 通过，包 26.6 KB、9 个文件。解包后用最小环境启动：回 0.3.7、11 个工具、`instructions` 1715 字。
- 未验证：在 Claude 桌面端里真实安装和授权（本机 Claude 桌面端没登录）。

## 0.3.6 · Claude 桌面端扩展

新增：`plugins/100x/manifest.json`，用 `npm run pack:desktop`（`@anthropic-ai/mcpb` 2.1.2）把桥接打成 `100x.mcpb`，Claude 桌面端双击安装，用它自带的 Node 跑同一个 `scripts/bridge.mjs`。`.mcpbignore` 去掉 SKILL、Codex/Claude Code 清单和安装脚本，包里只有图标、清单和 5 个运行文件，23 KB。Claude 桌面端上报的 `clientInfo` 是 `{"name":"claude-ai","version":"0.1.0"}`，没有 `title`，所以扩展用环境变量 `HUNDREDX_HOST=Claude` 定设备名，授权页显示「Claude · macOS」，不显示 `claude-ai`。

2026-11-20 在 Mac 上实际跑过：

- `node --test tests/*.test.mjs`：38 项通过，4 项只在 Windows 或装了 PowerShell 时跑，跳过。新加：三份清单版本一致、桌面端入口和 Codex 指向同一个桥接；设备名按 `HUNDREDX_HOST` 起。
- `mcpb validate` 通过；解包后在 `/` 目录、空 `HOME`、只有系统 PATH 的环境里用 Node 24（和 Claude 桌面端 2.42304 自带的 Electron Node 24.22 同一主版本）启动：Claude 桌面端的 `initialize`（协议 2025-11-25）回 2025-03-26，11 个工具，无凭据时 `100x_connection_status` 返回 `100X_NOT_CONNECTED`。
- 未验证：在 Claude 桌面端里双击安装和真实授权。本机 Claude 桌面端没登录，Windows 没装 Claude 桌面端。

## 0.3.5 · Claude Code 插件

新增：仓库根目录 `.claude-plugin/marketplace.json` 和 `plugins/100x/.claude-plugin/plugin.json`，Claude Code 用原生插件命令安装同一个插件目录。Claude Code 只展开 `${CLAUDE_PLUGIN_ROOT}`，不认 Codex 的 `${PLUGIN_ROOT}`，所以 Claude 清单里内联同名 `100x` 的 `mcpServers`，覆盖 `.mcp.json` 里那份。桥接把 `initialize` 里的客户端名转给服务端（`_meta["io.modelcontextprotocol/clientInfo"]`），网页「来源 App」能认出 Claude Code 和 Codex；授权设备名也按宿主写，比如「Claude Code · macOS」。

2026-11-20 在 Mac 上实际跑过：

- `node --test tests/*.test.mjs`：29 项通过，4 项只在 Windows 或装了 PowerShell 时跑，跳过。新加的「转发客户端名」测试放到旧桥接上会挂。
- Claude Code 2.1.328 用隔离的 `CLAUDE_CONFIG_DIR`：`claude plugin marketplace add <本地仓库>`、`claude plugin install 100x@100x` 成功，`claude mcp list` 只有一个 `plugin:100x:100x` 且 Connected。没加内联 `mcpServers` 前它读 `.mcp.json`，报 `CONNECTION_CLOSED`。
- `claude --plugin-dir plugins/100x -p …`：列出 11 个 `mcp__plugin_100x_100x__100x_*` 工具和 `100x:100x-creative` skill；无凭据时 `100x_connection_status` 返回 `100X_NOT_CONNECTED`。
- Claude Code 上报的 `clientInfo` 是 `{"name":"claude-code","title":"Claude Code"}`，100x 网页已有这个别名的图标。
- 已连上时再调 `100x_connect` 直接返回已连接，不发新授权：Codex 连过的电脑在 Claude Code 里再发「连接 100x」，不会换掉凭据、丢掉旧任务。
- 查连接时遇到网络或服务错误，`100x_connect` 报错不重新授权；只有未连接或凭据失效才发新授权。安装器 `--connect` 遇到已连接直接成功退出。
- 设备名按服务端 64 个 UTF-16 码元的上限裁宿主名，系统后缀保留；客户端名和版本按完整字符裁剪。
- 已知限制：旧版（0.3.4 及更早）Codex 插件不上报来源，和 0.3.5 的 Claude Code 共用一份凭据时，Codex 的任务可能显示成 Claude Code。Codex 升级到 0.3.5 就没有这个问题。
- 未验证：Claude Code 里走完真实网页授权和真实生成。


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
