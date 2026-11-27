# 87 ARCADE · ID8 仪表小组件

`render.js` 使用上游 Canvas 绘图与离线烘焙字体（`assets/fonts/arcade-num.json`、`arcade-label.json`，Barlow Semi Condensed Bold/SemiBold），不依赖浏览器 DOM。网页模拟器和车端 `vehicle.js` / `widget.js` 调用同一绘制函数。

## 仪表布局（2026-11-27）

ROAD（1120 × 660，5 fps）和 SPORT（760 × 556，10 fps）可分别设置 1 至 3 栏。各栏可等宽，也可选一栏作为加宽主视图。每栏可放轮胎、G 表或数据卡，数据卡支持从 28 项指标中选择并排序。空间充足时显示带刻度游标的横条，项目较多时改用紧凑行，宽栏可分两列。缩窄后用 `+N` 标出暂时放不下的项目，保留原有选择。

卡片采用 BMW ID8 / G87 M2 Live Cockpit 的视觉风格，深碳黑底色配顶部细光带。胎压和胎温沿俯视底盘轮廓标出对应车轮，G 表用精细准线标出横纵向加速度，并保留 2 秒轨迹与本次驾驶的极值轮廓。仪表顶部为导航留空。

温度和压力可按指标设置颜色阈值。低温显示蓝色，低压显示琥珀色，达到高限显示红色；读数缺失或过期显示 `--`。阈值用于显示提示。组件首次显示时播放 1 秒启动动画，随后切回实时读数。动画与常态绘制共用每秒 5,500 KiB 的上传预算。

## 数据采集与温和共存诊断

- **被动 SOME/IP**：油温/水温（CDS）、四轮胎压胎温（TPMS）、横纵向 G（CDS2）、仪表模式（Vehicle2）及实际涡轮增压（FES `displayBoostPressure`）。
- **常驻只读诊断（`diag-probe.js`）**：默认运行 `ID8_DIAG_MODE=live`，仅在组件可见（`shown`）且处于有效点火电源状态时，向 DME (`0x12`) 发送单帧只读 UDS `0x22` 请求，读取 5 个 S58 实车验证 DID（`0x580F` 进气温度、`0x586F` 机油绝压与 `0x4201` 大气压折算表压、`0x5658` 高压燃油压力、`0x4650` 变速箱油温）。
共存开关 `obdCoexistence` 可在中控设置中即时切换。退避从本次请求结束时起算，遇到拒绝、超时或传输错误时按表中顺序轮换。

| OBD 共存 | 正常采样间隔 | 读数有效期 | 退避等待（ms） |
| --- | --- | --- | --- |
| 关闭（默认） | 1 秒 | 10 秒 | 800 / 1200 / 1600 |
| 开启 | 3 秒 | 25 秒 | 1370 / 1890 / 2410 / 1630 |

- **模式与日志控制**：设置 `ID8_DIAG_MODE=probe` 可切回六阶段对照实验，设置 `ID8_DIAG_PROBE=0` 可关闭主动诊断；设置 `ID8_DIAG_LOG` 可将 JSONL 日志写入指定文件（超过 5 MiB 自动轮转为 `.1`）。
- **G 极值持久化（`g-history.js`）**：对本次驾驶凸包做 `0.01 g` 量化并上限 64 个角向顶点，通过 `framework/widgets/state.js` 原子持久化保存，按熄火休眠或系统重启开启新一轮驾驶统计。

## 中控设置

`cid-settings/` 提供原生 BMW ID8 中控设置应用 `arcade_settings 0.1.3`。启动器使用固定的 87 ARCADE 官方图标，页面左上角显示俱乐部字标。`mgu-render/1` 图形界面按中控屏可用宽度铺满，支持触摸和 CCU 旋钮，也可回退到原生 RHMI 列表。保存后，设置应用通过本地 Unix socket 将配置交给 manager；manager 原子写盘，再通过 IPC 通知仪表重绘，无需重启。构建依赖见[中控设置说明](cid-settings/README.md)。

## 当前架构

`widget.js` 提供绘图函数、信号声明、数据转换与诊断探针入口。`framework/widgets/runtime.js` 负责连接、仪表模式切换（ROAD 5 fps / SPORT 10 fps）和按横向三分区脏矩形 RGBA 上传。`manager.js` 统一启动已注册组件并转发 `lifecycle.js` 的车辆电源状态。修改后的 cluster-render 统一处理各模式的选择记忆、切换恢复与启动恢复。

组件名称为 **87 Arcade**，菜单缩略图使用 `assets/preview.png` 中的完整俱乐部 Logo。`app.json` 同时声明名称、缩略图与组件入口，不是 MGU Store 安装清单。

架构、注册方法和组件接口见 [框架说明](framework/widgets/README.md)。注册表持久保存 target/content/scene 标识，移除后重装保留原标识。每种仪表模式的组件选择单独持久保存，默认文件为 `/var/opt/cluster-render/state/widget-selection.txt`。

## 构建与部署依赖

依赖 [idrive-apps](https://github.com/robertnisipeanu/idrive-apps) 的 cluster-render 与 [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) 的 Canvas/signals。车端还需要车辆已有的 SDK、原生模块和只读 SOME/IP 接口定义（包含 Lifecycle 的 Front 实例及诊断所需接口）。本仓库不分发这些车辆资源，也不是直接安装包。

离线字体图集由 `tools/bake-fonts.py` 生成，如需重新烘焙可传入本地 TTF 目录：`python3 tools/bake-fonts.py /path/to/fonts`。

当前补丁 [cluster-render-v3.patch](patches/cluster-render-v3.patch) 基于 idrive-apps 提交 `88e8554b1d81593d85f8095b4f0c38213223990d`，累计包含 v2.3 与持久化、多组件注册和公共恢复改动。在该上游提交应用补丁后，必须构建并同步部署 **cluster-render 启动器和 cluster-render-idrive8**，以及补丁中的 JS 客户端。

## 本地检查

状态、注册、数据、G 历史与诊断调度测试可直接运行：

```sh
node framework/widgets/check.js
node settings.test.js
node cid-settings/lifecycle.test.js
node vehicle-data.test.js
node g-history.test.js
node diag-probe.test.js
```

图层与带宽测试需要两个上游源码目录，默认查找本仓库旁边的 `idrive-apps` 与 `idrive7-apps`，也可显式指定：

```sh
export IDRIVE_APPS=/path/to/idrive-apps IDRIVE7_APPS=/path/to/idrive7-apps
node configured-render.test.js
node vehicle-layout.test.js
```

渲染测试默认查找相邻的 `simulator/profiles.js`，也可用 `SIMULATOR_DIR` 指定模拟器目录。缺少模拟器时使用合成驾驶数据。私有接口文件缺失时，仅跳过依赖这些文件的校验。

## 更新记录

- **2026-11-27**：新增分栏与指标设置、中控实时同步、启动动画和 OBD 共存开关。

- **2026-11-26（ROAD 方案 B + 温和共存 `v5` 实车通过）**：将普通模式重构为左 4 温度 / 中 4 胎加居中字标 / 右 3 压力三栏中轴对称布局并全部命中原生烘焙字号（车机缓存渲染提速至 14 ms）；针对全天通勤日志定位的 3.25 秒拒帧锁相问题及外接方向盘转速灯滞后现象，将常驻 `live` 调整为 3 秒常态节拍、拒帧完成时刻起 `1370/1890/2410/1630 ms` 错相退让与 25 秒保鲜期，经实车测试通过。
- **2026-11-25**：实车 6 分钟路试验证单帧 5-DID 只读 UDS `0x22` 与外接设备共存，涡轮增压改走被动 `FES.displayBoostPressure`；上线三分区脏矩形 RGBA 上传、64 顶点 G 包络、粗体字库与 SPORT 实车硬裁切标定。
- **2026-11-22**：部署公共框架与选择记忆持久化，复盘记录保留在 [选择记忆错误复盘](docs/POSTMORTEM-20261122.md)，历史实验保留在 [历史实验记录](patches/WIDGET-RESTORE-TEST.md)。

仓库仅包含源码、测试、补丁、离线字库与俱乐部提供的 Logo。车辆日志、密钥、车辆接口导出、二进制与构建产物均不提交。
