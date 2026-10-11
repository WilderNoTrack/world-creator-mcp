# 造世界编辑器 MCP

让 Agent 通过 MCP 直接操作造世界编辑器的画布、资产、环境和 Lua 脚本。**非官方社区适配器**，依赖已安装编辑器的内部接口；目前验证环境为 Windows、Node.js 24、编辑器 1.0.82。

当前版本 **0.6.0**，提供 **56 个工具**。使用本地 stdio 通信，画布操作经本机 CDP 调用编辑器服务，不需要模拟鼠标点击。

## 快速开始

需要 Node.js 24 或更高版本、已安装并登录的造世界编辑器。解压 Release 的源码包，或克隆本仓库。

```powershell
git clone https://github.com/WilderNoTrack/world-creator-mcp.git
cd world-creator-mcp
npm ci
$env:WORLD_CREATOR_INSTALL = 'D:\造世界编辑器'
npm run build:adapter
npm test
```

先保存并退出已有编辑器，再用连接脚本启动。脚本不会强制结束现有编辑器进程。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-editor.ps1 -InstallRoot $env:WORLD_CREATOR_INSTALL
```

打开目标项目，并保持编辑器窗口显示。默认调试地址是 `http://127.0.0.1:49221`。

在 MCP 客户端中按 [mcp.example.json](mcp.example.json) 添加配置，将 `args` 改为你实际解压目录下 `src/server.mjs` 的绝对路径。`node` 不在 PATH 时，使用 Node 可执行文件的完整路径。

| 环境变量 | 默认值 / 作用 |
|---|---|
| `WORLD_CREATOR_INSTALL` | `D:/造世界编辑器`，编辑器安装目录；构建适配器和查询模型配置使用 |
| `WORLD_CREATOR_PROJECTS` | `%APPDATA%/AI World Creator/projects`，允许访问的项目根目录 |
| `WORLD_CREATOR_CDP_URL` | `http://127.0.0.1:49221`，只接受本机回环 HTTP 地址 |

自定义调试端口时，启动脚本的 `-Port` 与 `WORLD_CREATOR_CDP_URL` 必须一致。建议 MCP 客户端超时至少 180 秒。编辑器升级后重新执行 `npm run build:adapter` 并核对兼容性；正常启动编辑器可能不带连接参数，需要使用启动脚本。

## 能力

工具前缀均为 `worldcreator_`；完整清单和权限提示见 [docs/tools.json](docs/tools.json)。

| 类别 | 主要工具 | 功能 |
|---|---|---|
| 连接与项目 | `status`, `project_list`, `project_open` | 查看状态、列出首页项目、打开已有项目 |
| 画布 | `canvas_scene`, `canvas_node`, `canvas_update`, `canvas_save` | 查对象、调整位置/旋转/缩放、原生保存并备份 |
| 模型与基础物体 | `canvas_import_glb`, `canvas_add_asset`, `canvas_replace_asset`, `canvas_create_primitive`, `canvas_create_special` | GLB 导入、放置、替换、基本形状、灯光/文字/水体 |
| 场景组织 | `canvas_delete`, `canvas_group`, `canvas_ungroup`, `canvas_focus`, `canvas_history` | 删除、分组、聚焦、撤销/重做 |
| 素材 | `asset_search`, `canvas_assets` | 搜索官方/个人/收藏素材库，查询已加载资产 |
| 组件与物理 | `canvas_component_schema`, `canvas_component_update`, `canvas_physics` | 按原生可编辑字段设置材质、灯光、碰撞、刚体等 |
| 脚本 | `script_files`, `script_read`, `script_write`, `script_refresh`, `canvas_scripts`, `canvas_script_bind`, `canvas_script_unbind`, `canvas_script_params` | 管理项目 Lua 源码、诊断、挂载及参数 |
| 环境 | `settings_read`, `settings_update` | 光照、雾、天气、已加载模板、移动/跳跃等世界规则 |
| 地形与撒点 | `pcg_context`, `pcg_start`, `pcg_selections`, `pcg_select`, `canvas_pcg_status`, `job_status`, `job_cancel` | 地形/撒点生成、素材选择、云端合成、画布激活和任务管理 |
| 运行与诊断 | `canvas_preview`, `canvas_debug`, `canvas_runtime_object`, `canvas_terrain`, `canvas_capture`, `debug_capabilities` | 预览、对象运行状态、地形高度采样、本机截图 |
| 世界上传 | `publish_prepare`, `publish_submit`, `publish_status` | 审核上传计划、显式提交、查询远端处理状态 |
| 作者工作区 | `list_workspaces`, `list_files`, `read_file`, `write_file`, `inspect_model`, `archive_module`, `validate_lua`, `models` | 作者文件、模型检查/归档、Lua 语法、模型配置 |

### 常用调用顺序

- 导入画布：`canvas_scene` → `canvas_import_glb` → `canvas_add_asset` → `canvas_update` → `canvas_focus` → `canvas_save`。
- 修改文件：读取 SHA-256 → 携带 `expectedSha256` 更新；新建传 `null`。脚本更新保留 `id/referenceName/assetRef` 注释，新脚本自动分配标识。
- 修改环境：`settings_read` 读取 `revision` → `settings_update` → `canvas_save`。
- 撒点：已有 completed 地图产物 → `pcg_context` → `asset_search` → `pcg_selections` / `pcg_select` → `pcg_start`。先 `dryRun=true`；正式操作用唯一 `requestId`，之后查询 `job_status`。
- 世界上传：保存 → `publish_prepare` → 用户确认具体计划 → `publish_submit` → `publish_status`。计划 10 分钟失效，场景或 Lua 变更需重新准备。

旋转使用局部欧拉角（度）。普通修改不会自动保存。预览期间拒绝场景修改。返回超时代表结果未知，应先读回状态，不能盲目重试删除、撤销、云端生成或上传。

## 验证状态和限制

- 已实测模型检查/归档、GLB 上传导入、画布放置/编辑/保存、素材搜索、环境编辑、Lua 管理及原生拾取/放下场景。
- 地形、撒点选材和云端合成已有真实调用记录；地图激活曾在原生散布节点停滞。支持针对可识别任务取消，部分场景改动会保留，不能保证任意地图完整激活。
- 组件编辑限于原生 schema 标记可编辑的字段；没有通用任意组件注入。自定义天空/反射纹理等复杂资源选择器未开放。
- **没有已验证的 Lua 断点、单步和局部变量接口**；`debug_capabilities` 如实报告此限制。
- 世界上传准备和状态查询已测试；实际上传提交尚未完成端到端验收。上传成功也不等于公开上架。
- PCG 需要编辑器中已有地图会话和相应完成产物；部分原生操作会使用网络或消耗编辑器积分。
- 原生内部接口会随编辑器版本变化；不是官方 SDK 或安全沙箱。

## 测试与发布

```powershell
npm test                       # 隔离测试与 MCP stdio 工具发现，不修改真实世界
npm audit --omit=dev            # 查询依赖漏洞数据库
npm run catalog                # 更新工具清单，不连接编辑器
npm run package                # 从干净的 Git HEAD 生成源码 ZIP 和 SHA-256
```

原生模型集成测试需要你明确提供可信模型和能改变几何的源码替换。脚本复制模型及工作区 `official` 依赖到 `.local/smoke-*`，只修改副本：

```powershell
$env:WORLD_CREATOR_SMOKE_MODULE = 'C:\my-project\assets\module\module-example'
$env:WORLD_CREATOR_SMOKE_FIND = 'const width = 2;'
$env:WORLD_CREATOR_SMOKE_REPLACE = 'const width = 3;'
npm run smoke
```

以下是会修改真实测试项目的集成测试，仅在专门的已保存测试项目中运行，期间不要手动编辑：

```powershell
node scripts/live-smoke.mjs project_ID C:\models\example.glb --confirm-upload
node scripts/smoke-workflow.mjs project_ID
node scripts/smoke-advanced-canvas.mjs project_ID
node scripts/smoke-canvas-controls.mjs project_ID
```

导入测试会把 GLB 上传到编辑器素材服务；临时画布对象会清理，已上传的库素材保留。控制测试需要项目中存在 `ms-rotate.lua`。详细备份和测试报告保存在 `.local/`，不随公开源码包发布。

## 安全与许可

参见 [SECURITY.md](SECURITY.md) 和 [CHANGELOG.md](CHANGELOG.md)。源码采用 MIT 许可；此许可不覆盖编辑器、官方依赖、账户资源或第三方素材。

发行包只包含本适配器源码、测试和文档，**不包含编辑器源码、内部编译 worker、账号凭据或用户世界**。每位使用者需安装编辑器并在自己电脑上构建 `.local/native-worker.cjs`。
