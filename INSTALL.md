# 安装 100x 到 Codex 桌面端、Claude Code 或 Claude 桌面端

本文用于用户将仓库交给 Codex 或 Claude Code 安装。Claude Code 看下面「Claude Code」一节，其余步骤是 Codex 的。只安装公开客户端插件和 SKILL，不部署服务器。

## 按顺序执行

1. 检查本机 `node --version`（22+）、`git --version`、`codex plugin add --help`。缺少依赖时说明缺项，不自动全局安装或修改系统设置。
2. 从 `https://github.com/kezd088/100x-MCP` 下载或克隆到持久目录，先阅读 `install.ps1` 与 `plugins/100x/.mcp.json`。不要把临时目录当长期插件来源。
3. Windows 执行 `powershell -NoProfile -ExecutionPolicy Bypass -File ./install.ps1`；macOS 执行 `bash ./install.sh`。这里的 Bypass 只影响此进程，不修改系统执行策略。两个安装器使用同一套检查与 Codex 原生命令注册 GitHub 插件目录并安装 `100x@100x`；不启动 CLI 会话、不改其他插件或模型配置。
4. 检查 `codex plugin list --marketplace 100x --json`：`100x@100x` 必须已安装且 `enabled: true`。检查 `codex mcp list --json` 中出现 `100x`，并检查安装目录内 `skills/100x-creative/SKILL.md` 存在。仅文件存在不代表服务连接成功。
5. 在新任务中调用 `100x_connect`，打开返回的 100x 授权页面，将连接码展示给用户核对。用户自行登录并点击允许，Agent 不代替用户授予账户权限。按返回间隔检查 `100x_connection_status`，只有 `connected` 才算完成。备选入口是安装器的 `-Connect`（Windows）或 `--connect`（macOS）。不要索取令牌到聊天。
6. 提醒用户回到 Codex 桌面端新建任务，输入 `$100x:100x-creative 检查 100x 连接，列出可用型号和余额，不生成。` SKILL 和 MCP 工具在新任务中加载。此命令不扣生成积分。
7. 首次生成先查型号、报价，并按用户已授权的预算提交；保存返回的 100x 产物，在对话中展示本地绝对路径的图片或视频。失败保留任务号，不能换新幂等编号自动重复付费。

## Claude 桌面端

Claude 桌面端的聊天窗口不读插件市场，装扩展包：下载 `https://100xspeed.app/mcp/downloads/100x.mcpb`，双击用 Claude 打开并点「安装」；没弹窗就在 「设置 → 桌面应用」→「扩展」旁的「管理」→「高级设置」→「安装扩展…」 选这个文件；团队版、企业版开了扩展允许列表的，由组织所有者在 「组织设置 → 连接器 → 桌面」 上传并加给团队。扩展用 Claude 自带的 Node，不需要本机装 Node。装好后在新对话发「连接 100x」，把授权链接和连接码给用户核对，用户允许后按返回间隔查 `100x_connection_status`，只有 `connected` 才算完成。凭据与 Codex、Claude Code 共用。

打包（维护者）：`npm run pack:desktop` 生成 `dist/100x.mcpb`，传到 GitHub Release 和文档站 `mcp/downloads/100x.mcpb`。

## Claude Code

1. 检查 `node --version`（22+）和 `claude plugin --help`。缺少依赖时说明缺项，不自动全局安装。
2. 运行 `claude plugin marketplace add kezd088/100x-MCP`，再运行 `claude plugin install 100x@100x`。不改其他插件、MCP 或模型配置。
3. 运行 `claude plugin list`，`100x@100x` 必须是 enabled；再运行 `claude mcp list`，`plugin:100x:100x` 必须是 Connected。
4. 提醒用户新开 Claude Code 会话，或在当前会话运行 `/reload-plugins`，然后发送「连接 100x」：调用 `100x_connect`，把返回的授权链接和连接码给用户核对，用户自行登录并允许，按返回间隔查 `100x_connection_status`，只有 `connected` 才算完成。不要索取令牌到聊天。
5. 检查连接用 `/100x:100x-creative 检查 100x 连接，列出可用型号和余额，不生成。`，不扣生成积分。

凭据与 Codex 共用：同一台电脑已在 Codex 连过 100x，Claude Code 直接可用，不用再连。卸载：`claude plugin uninstall 100x@100x`。

## 一条安装命令（Codex）

Windows PowerShell（可以先浏览本仓库的 `install.ps1`）：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/kezd088/100x-MCP/main/install.ps1))) -Connect
```

PowerShell 处在受限语言模式（`$ExecutionContext.SessionState.LanguageMode` 显示 `ConstrainedLanguage`，常见于开了 AppLocker 或 WDAC 的公司电脑）时，上面这行会被拦，改用这条：

```powershell
iex ('& {' + ((irm https://raw.githubusercontent.com/kezd088/100x-MCP/main/install.ps1) -replace '^\uFEFF') + '} -Connect')
```

macOS 终端（可以先浏览本仓库的 `install.sh`）：

```sh
curl -fsSL https://raw.githubusercontent.com/kezd088/100x-MCP/main/install.sh | bash -s -- --connect
```

如果交给 Codex 执行，省略 `-Connect` / `--connect`，在新任务中发送「连接 100x」，由用户在网页确认授权。之后的生成都在桌面端对话中进行。

## 手动安装 / 其他平台

```sh
codex plugin marketplace add kezd088/100x-MCP --json
codex plugin add 100x@100x --json
```

macOS 凭据存在当前用户的钥匙串（`security` 服务名 `100x-codex`），配置文件在 `~/Library/Application Support/100x/connection.json` 且只记录条目引用。Windows 凭据用当前用户的 DPAPI 加密，存在 `%LOCALAPPDATA%/100x/connection.json`，文件只给当前用户和 SYSTEM；PowerShell 处在受限语言模式时同样能存。

网页授权不可用时，Windows 和 macOS 都可运行 `node <插件目录>/scripts/connect-manual.mjs` 手动录入地址与令牌（隐藏输入，不回显）。

Linux 的加密凭据向导仍未提供：`install.sh` 可以装插件，但保存凭据会明确报 `100X_CONFIG_PLATFORM`，不会退回明文保存。开发者可通过 `HUNDREDX_URL`（完整 `/api/mcp` 地址）及 `HUNDREDX_TOKEN` 环境变量接入，但桌面端必须实际继承这些变量；终端临时赋值不等于 GUI 已配置。

## 状态与更新

v0.3.6 默认连接 `https://100xspeed.app/api/mcp`，通过 100x 网页授权当前设备。安装不赠送积分。生产模型、规格与费用以 100x 实时目录及报价为准。更新可运行 `codex plugin marketplace upgrade 100x` 后重新执行安装器。卸载执行 `codex plugin remove 100x@100x`；加密凭据不会随之删除，需要清除时由用户自行管理：Windows 删 `%LOCALAPPDATA%/100x/connection.json` 及其备份，macOS 删 `~/Library/Application Support/100x/connection.json` 并在「钥匙串访问」中删除服务名 `100x-codex` 的条目。

开发验证可使用 `./install.ps1 -Source <本地仓库绝对路径>` 或 `./install.sh --source <本地仓库绝对路径>`；这只应连接本机测试服务。不要把 localhost 地址作为其他用户的公网接入地址。
