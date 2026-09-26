# EasyVideo

> 流式直播与视频应用。P2P / BT / SERVER 三种传输模式，依赖全自包含，单文件 EXE。

[简体中文](README.md) · [English](README.en.md)

---

## 它是什么

EasyVideo 把「开一场直播」和「发一个视频」收进同一个本地应用：双击 EXE，浏览器打开 `http://localhost:13750/`，数据全部留在 `data/` 目录。

HTTP 内核、WebSocket 帧、路由器、切片分发、转码桥都是自己写的，不依赖任何第三方运行时。ffmpeg、aria2、7-Zip、Node、zstd 以「组件」的形式放在 `program/`，随安装包一起分发，运行时不需要联网。

## 特性

### 直播

- 三种传输模式，同一套切片存储：
  - `SERVER`：主机用 HTTP 直接供片，CPU 占用最低，需要一条粗上行；
  - `P2P`：单对多，主机把每片推给每个观众，人数多时延迟升高；
  - `BT`：谁有谁发，主机只补种，人越多越快。
- **主播界面与观看界面分离**：主播看到开播/停播、垫片设置、推流状态、观众数与覆盖率；观众看到播放器和弹幕。
- **未开播状态可设**：黑屏，或循环播放一段垫片视频。
- 切片推流：主播把编码后的切片 POST 上来，观众按需 GET。单片上限 8 MiB，每流保留最近 900 片。
- 私密房间（仅好友 / 仅自己）、房间人数限制、回放录制、指定弹幕浮窗。

### 视频

- 多段合集、草稿箱、本地上传 / 云端链接 / 本地路径三种来源。
- 上传走流式写盘，**不受 2 GiB 内存缓冲上限限制**，界面带进度条。
- 画质梯度 360P / 480P / 720P / 1080P / 2K / 4K；编码器可选 H.264 / H.265 / H.266 / AV1 / AMF / NVENC / 软件。
- 播放器：高能进度条、画中画、网页全屏、倍速、字幕、音量 0–200%、键盘快捷键。

### 推荐与社交

- 两个 64M 参数的小型排序模型（直播一个、视频一个），跟随搜索行为在线学习，界面上不出现。
- 标签权重推荐：按访问过的标签累计权重、衰减后做轮盘赌抽样，卡片实时加载。
- 点赞 / 收藏 / 转发 / 评论；评论可点赞、可删除。

### 界面

- 左侧图标栏 + 顶栏，八个入口：直播、视频、历史记录、稍后再看、收藏、好友、我的、设置。
- **可换主题**：内置 OBS 深灰、放映厅、B 站粉、浅色纸白、高对比五套；四个主色可用取色器微调。
- **主题包**：`.zst` 压缩的 tar，含 `package.json`、`settings.json`、`background/`、`maincolor/`。

### 工程

- 插件宿主：`.zst` / `.evp` 包，内置 ZSTD 解析器，可挂路由、面板、事件钩子。
- 自包含组件：ffmpeg、aria2、7-Zip、Node、zstd 全在 `program/`，不依赖系统 PATH。
- 单文件 EXE（Node SEA，89 MiB），双击即用。
- 安装包：先选语言 → 解压到缓存 → 安装；之后可重新安装 / 修复 / 卸载。

## 快速开始

### 用安装包

1. 从 Releases 下载 `EasyVideo-v1.0.0pre1-Setup.exe`；
2. 运行，先选语言（简中 / 繁中 / 英 / 日 / 韩 / 德 / 法 / 俄 / 西 / 葡）；
3. 安装程序先把内容解到 `%TEMP%/EasyVideo/cache/payload`，再从缓存安装；
4. 勾选需要的项：开始菜单快捷方式、桌面快捷方式、把 `ev` 注册到 PATH、完成后启动；
5. 完成后双击图标，浏览器打开 `http://localhost:13750/`。

再次运行同一个安装包时，会先问你要 **重新安装** / **修复** / **卸载**。每个文件在安装时都把 SHA-256 写进注册表 `HKCU/Software/EasyVideo/Files`，修复就是照着它补齐。

### 从源码运行

需要 Node.js 22 或更高（本项目在 24.19.0 上开发）。

    npm install     # 构建期依赖：esbuild / sharp / postject / rcedit
    npm start       # 开发服务器，默认 http://127.0.0.1:13750/

### 打一个自己的安装包

    node tools/fetch-components.mjs   # 下载 ffmpeg / aria2 / 7-Zip / Node / zstd 到 program/
    node build.mjs                    # 生成 dist/EasyVideo.exe
    node tools/package.mjs            # 产出 app/EasyVideo.exe 与 installer/*-Setup.exe

## 命令行

| 参数 | 作用 |
| --- | --- |
| `-b` | 后台启动，不打开浏览器 |
| `-br` | 后台启动，稍后自动打开界面（默认 1500 ms，可用 `--open-delay=毫秒` 调整） |
| `-nob` | 启动但不打开浏览器 |

协议 `ev://` 在启动时自动注册：

| 链接 | 打开 |
| --- | --- |
| `ev://live/<昵称>/<PID>` | 直播间 |
| `ev://video/<昵称>/<PID>` | 视频 |
| `ev://live/search/<base64>` | 一次搜索 |

安装时若勾选了 PATH 注册，终端里直接敲 `ev` 就能启动。

## 目录结构

    EasyVideo/
      app/EasyVideo.exe            单文件可执行程序
      app/README.txt  app/version.json
      data/                        数据库、媒体、录制、备份、回收站、settings.json
      log/                         滚动日志
      program/                     自带组件
        ffmpeg/  aria2/  7zip/  node/  zstd/
        plugins/                   插件包（.evp / .zst）
      sourcecode/                  源码副本
      installer/                   NSIS 脚本与产物
      src/server/  src/web/        源码

临时缓存 `%TEMP%/EasyVideo/`，回收站 `%TEMP%/recyle.bin/EasyVideo/`，备份 `%TEMP%/backup/EasyVideo/`。

## 传输模式

| 模式 | 数据怎么走 | 什么时候用 |
| --- | --- | --- |
| `SERVER` | 主机把每一片通过 HTTP 发给所有观众 | 上行够粗、想要最低延迟 |
| `P2P` | 主机把每一片推给每个观众 | 观众少、想省服务器 |
| `BT` | 主机只补种，持有切片的观众互相转发 | 观众多，人越多越快 |

三种模式共用同一套切片存储：主播 POST `/api/transport/segment/:streamId/:index`，观众 GET 同一路径，`/api/transport/segments/:streamId` 一次问清楚有哪些片。
## 主题

设置 → 界面主题：换主题、调四个主色、装主题包。内置 OBS 深灰、放映厅、B 站粉、浅色纸白、高对比。

主题包是 `.zst` 压缩的 tar：

    /
      package.json       name / version / introduction / releases
      settings.json      background_next_sec、maincolor 等
      background/        背景图，可多张，按秒轮换
      maincolor/         主色纯色图，64x64

主色也可以用 `#RRGGBB.png` 这样的文件名放进 `maincolor/`，会被自动识别。

## 插件

插件放在 `program/plugins/`，两种形态：

- `<名字>.evp`：单个 `zstd(JSON)` 包，装完重启生效；
- `<名字>/plugin.json + main.js`：松散目录。

插件通过注入的 `api` 挂载能力：

    api.get('/hello', function (ctx, req, res) { res.json({ ok: true }); });
    api.panel({ id: 'hello', title: 'Hello', icon: 'sparkles' });
    api.on('video.publish', function (payload) { /* ... */ });

源码在 `(api, module, exports, console)` 作用域里执行，只能通过 `api` 触达服务端。

## HTTP 接口速览

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 运行时长、内存、连接数、流 |
| `GET /api/components` | 自带组件巡检 |
| `GET /api/themes` | 主题列表与当前生效 |
| `GET /api/themes/css` | 当前主题渲染出的 CSS |
| `POST /api/themes/install` | 安装主题包 |
| `POST /api/live` | 新建直播间 |
| `POST /api/live/:id/start` | 主播开播 |
| `POST /api/live/:id/standby` | 未开播画面：黑屏 / 垫片视频 |
| `POST /api/live/:id/end` | 结束直播（幂等） |
| `DELETE /api/live/:id` | 删除直播间 |
| `POST /api/live/:id/join` | 观众加入 |
| `POST /api/transport/segment/:streamId/:index` | 主播推流一片 |
| `GET /api/transport/segment/:streamId/:index` | 观众拉一片 |
| `GET /api/transport/segments/:streamId` | 有哪些片 |
| `POST /api/upload` | 流式上传，支持超大文件 |
| `GET /api/recommend` | 标签权重推荐 |

## 常见问题

**端口被占用？** 默认 `13750`。用环境变量 `EV_PORT` 换端口，或改 `data/settings.json`。

**转码不可用？** 到「设置 → 自带组件」看 ffmpeg 是否就绪；缺失时运行 `node tools/fetch-components.mjs` 补齐。

**托盘图标没出来？** 托盘用 PowerShell WinForms，脚本落盘时带 UTF-8 BOM。手动改过 `%TEMP%/EasyVideo/runtime/tray.ps1` 又去掉 BOM，PowerShell 5.1 会按 ANSI 解码并报一串语法错误。

**只能开一个实例吗？** 是，锁文件在 `data/easyvideo.lock`。进程被强杀留下的旧锁会在下次启动时检查 PID，死了就自动接管。

**上传大文件失败？** 现在走流式写盘，不再受 Node 单个 Buffer 2 GiB 的限制。如果看到 `length is out of range`，说明用的是旧构建。

## 许可

本项目使用 [MIT 许可](LICENSE)。

图标字形来自 [lucide](https://lucide.dev/)（ISC 许可），见 `assets/icons/LICENSE`。

随包分发的组件各自遵循上游许可：FFmpeg（LGPL/GPL）、aria2（GPL-2.0）、7-Zip（LGPL）、Node.js（MIT）、Zstandard（BSD-3）。
