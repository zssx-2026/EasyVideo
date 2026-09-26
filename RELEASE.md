# EasyVideo v1.0pre1

[简体中文](#简体中文) · [English](#english)

---

## 简体中文

第一个预览版。这一版把「能跑起来」和「能放心用」之间的坑基本填完了：直播链路打通，依赖全部自带，安装包重做，界面可换主题。

### 新功能

**直播**

- 主播与观众是两套界面。主播侧有开播 / 停播、垫片设置、推流状态、观众数与覆盖率；观众侧是播放器和弹幕。
- 新增 `POST /api/live/:id/start`：真正开始推流。之前建房和开播是一步，导致主播没有「开始」的动作。
- 新增 `POST /api/live/:id/standby`：未开播时观众看黑屏还是循环垫片视频，由主播定。
- 切片推流：主播 `POST /api/transport/segment/:streamId/:index`，观众 `GET` 同一路径。`GET /api/transport/segments/:streamId` 一次问清有哪些片。单片上限 8 MiB，每流保留最近 900 片，磁盘占用有上界。
- 新增 `DELETE /api/live/:id`：直播间可以删除了（之前只能结束）。

**视频**

- 上传改走流式写盘，**不再受 Node 单个 Buffer 2 GiB 的限制**；前端带进度条。
- 新增 `DELETE /api/live/:id` 同级的视频删除链路，补上「无法删除视频」。

**主题**

- 内置五套主题：OBS 深灰、放映厅、B 站粉、浅色纸白、高对比。
- 四个主色可以用取色器逐个调，改动即时生效。
- 主题包：`.zst` 压缩的 tar，装完立即切换。

**工程**

- 自带组件：ffmpeg、aria2、7-Zip、Node、zstd 全部落在 `program/`，运行时不依赖系统 PATH，也不需要联网。`GET /api/components` 可以巡检。
- 启动开关：`-b` 后台启动、`-br` 延迟打开界面、`-nob` 不打开浏览器。
- 安装包重做：先选语言（十种）→ 解压到缓存 → 安装；之后可重新安装 / 修复 / 卸载。每个文件的 SHA-256 写进 `HKCU/Software/EasyVideo/Files`，修复照它补。
- PID 改为任意长度的可打印 ASCII；路径里的 PID 走 base64url，不再需要转义。

### 修掉的问题

**界面**

- `页面渲染失败：Cannot access 'input' before initialization` —— `avatarField()` 里 `const input = input({...})` 遮蔽了同名的导入函数，同一语句内触发 TDZ。局部改名。
- `加入直播失败：Cannot read properties of null (reading 'length')` —— `social.js` 的插件安装路由残留 `!ctx.rawBody && rawBody.length`，`rawBody` 未定义且优先级写错。改为 `!ctx.rawBody.length`。
- 主题下拉框永远停在第一项 —— `select()` 用 `setAttribute('value')` 设初值，而 `<select>` 的 value 不是反射属性；而且该函数根本没有 onChange 参数。改成建完 `<option>` 再赋 `node.value`，由调用方监听 change。
- 切换主题后界面不变 —— `/api/themes/css` 用 `res.text()` 发成 `text/plain`，浏览器不会把它当作样式表。改用 `res.buffer(..., 'text/css; charset=utf-8')`。
- 图标静默不显示 —— `palette / package / puzzle / thumbs-up / list-video / film` 不在 `ICON_NAMES`（82 个预生成字形）里，映射到相近的已有图标。
- 托盘菜单满屏 PowerShell 语法错误 —— `tray.js` 写 `.ps1` 时没有 BOM，PowerShell 5.1 按 ANSI 解码，中文标签被撕碎导致整个脚本解析失败。补 UTF-8 BOM。

**上传**

- `上传失败：The value of "length" is out of range ... Received 2900641657` —— 请求体先被 `Buffer.concat` 收进内存，而 Node 的单个 Buffer 上限是 2 GiB。改为流式写盘（`pipeBodyToFile`），并给缓冲型接口加了明确的上限与 413 报错。

**安装包**

- `Bad text encoding` —— 生成的 `.nsi` 没有 BOM，`Unicode true` 下 NSIS 按系统 ANSI 码页读取，中文直接报错。现在统一写 UTF-8 BOM。
- `Can't open language file ... TraditionalChinese.nlf` —— NSIS 里叫 `TradChinese`（不是 `TraditionalChinese`）和 `PortugueseBR`。
- `unknown variable/constant "EV_UNKEY"` —— `!define` 必须用 `${EV_X}` 展开，`$EV_X` 只会被当作未定义变量。
- `FileWrite expects 2 parameters, got 5` —— 在 NSIS 里拼 `ev.cmd` 的引号和换行太脆；改为由打包脚本预生成进 payload。
- `Call must be used with function names starting with "un."` —— 卸载节里的 `${StrRep}` 要写成 `${UnStrRep}`。
- `LangString` 必须在 `!insertmacro MUI_LANGUAGE` 之后，否则语言 id 未生效。
- 安装脚本改成自包含生成（`tools/installer-nsi.mjs`），不再依赖散落的模板片段。

### 已知限制

- 这是预览版：协议与数据格式仍可能变。
- 画面推流需要外部采集软件（OBS 等）把切片 POST 进来；内置采集尚未实现。
- 字幕识别与翻译模型尚未接入，界面上的字幕选项目前只切换轨道。

### 下载

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `EasyVideo-v1.0.0pre1-Setup.exe` | 121 MiB | 安装包，含全部组件 |

自包含：安装后无需再装 Node、ffmpeg 或任何运行库。
---

## English

The first preview release. Most of the gap between "it runs" and "it is safe to use" is closed: the live path works end to end, every dependency is bundled, the installer was rebuilt, and the UI is themeable.

### Added

**Live**

- Broadcaster and viewer are now separate UIs. The host gets start/stop, standby settings, publish state, viewer count and swarm coverage; viewers get the player and chat.
- `POST /api/live/:id/start` actually starts publishing. Previously creating a room and going live were one step, so the host had no "go live" action.
- `POST /api/live/:id/standby` chooses what viewers see off air: a black screen or a looping standby video.
- Segment push: the host POSTs to `/api/transport/segment/:streamId/:index`, viewers GET the same path, and `GET /api/transport/segments/:streamId` lists what exists. 8 MiB per segment, newest 900 kept per stream.
- `DELETE /api/live/:id` deletes a room (previously it could only be ended).

**Video**

- Uploads stream straight to disk, so **the 2 GiB single-Buffer ceiling no longer applies**, with a progress bar in the UI.
- Video deletion now works.

**Themes**

- Five built-in themes: OBS dark, cinema, Bilibili pink, paper light, high contrast.
- Four main colours adjustable with colour pickers, applied immediately.
- Theme packages: a `.zst`-compressed tar that switches the theme as soon as it is installed.

**Engineering**

- Bundled components: ffmpeg, aria2, 7-Zip, Node and zstd all live in `program/`. No PATH dependency, no network at runtime. `GET /api/components` reports their state.
- Start flags: `-b` background, `-br` delayed browser, `-nob` no browser.
- Rebuilt installer: pick a language (ten), unpack to cache, install; later runs offer reinstall / repair / uninstall. Every file SHA-256 goes to `HKCU/Software/EasyVideo/Files` and repair restores against it.
- PIDs are now arbitrary printable ASCII; in URLs they travel as base64url, so no escaping is needed.

### Fixed

**UI**

- `Cannot access 'input' before initialization` - `avatarField()` had `const input = input({...})`, shadowing the imported helper and hitting a TDZ in the same statement.
- `Cannot read properties of null (reading 'length')` when joining a live room - the plugin install route in `social.js` still had `!ctx.rawBody && rawBody.length` (`rawBody` undefined, wrong precedence). Now `!ctx.rawBody.length`.
- The theme dropdown was stuck on the first entry - `select()` set its initial value with `setAttribute('value')`, but a `<select>` value is not a reflected attribute; the helper also had no onChange parameter at all.
- Switching themes changed nothing - `/api/themes/css` answered with `res.text()`, i.e. `text/plain`, which browsers refuse to apply as a stylesheet.
- Icons silently disappeared - `palette / package / puzzle / thumbs-up / list-video / film` are not in `ICON_NAMES` (82 pre-generated glyphs); remapped to the nearest existing icons.
- The tray menu produced a wall of PowerShell syntax errors - `tray.js` wrote the `.ps1` without a BOM, so PowerShell 5.1 decoded it as ANSI and shredded the Chinese labels. It now writes UTF-8 with BOM.

**Upload**

- `The value of "length" is out of range ... Received 2900641657` - the request body was buffered with `Buffer.concat` before anything else, and a Node Buffer cannot exceed 2 GiB. Uploads now stream straight to disk (`pipeBodyToFile`), and buffered endpoints got explicit caps plus a 413.

**Installer**

- `Bad text encoding` - the generated `.nsi` had no BOM, so under `Unicode true` NSIS read it with the ANSI code page and rejected CJK text. It is now written as UTF-8 with BOM.
- `Can't open language file ... TraditionalChinese.nlf` - NSIS calls them `TradChinese` and `PortugueseBR`.
- `unknown variable/constant "EV_UNKEY"` - `!define` must be expanded as `${EV_X}`; `$EV_X` is just an undefined variable.
- `FileWrite expects 2 parameters, got 5` - building `ev.cmd` inside NSIS with embedded quotes and newlines is too fragile; the packaging script now pre-generates it into the payload.
- `Call must be used with function names starting with "un."` - inside the uninstall section `${StrRep}` must be written `${UnStrRep}`.
- `LangString` entries must come after `!insertmacro MUI_LANGUAGE` or the language ids are not in effect yet.

### Known limitations

- This is a preview: protocols and data formats may still change.
- Capturing the screen still requires an external tool (OBS and friends) that POSTs segments; built-in capture is not implemented yet.
- Subtitle recognition and translation models are not wired up; the subtitle selector only switches tracks today.

### Download

| File | Size | Notes |
| --- | --- | --- |
| `EasyVideo-v1.0.0pre1-Setup.exe` | 121 MiB | Installer, all components included |

Self-contained: after installing you do not need Node, ffmpeg or any runtime.
