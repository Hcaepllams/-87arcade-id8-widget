# 87 Arcade 设置

`arcade_settings 0.1.3` 是 BMW ID8 的原生中控设置应用。启动器显示固定的 87 ARCADE 官方图标，进入后左上角显示俱乐部字标。图形界面使用 `mgu-render/1`，按可用屏宽调整布局，支持触摸和 CCU 旋钮。图形服务不可用时回退到原生 RHMI 列表。

ROAD 和 SPORT 各自保存栏数、主栏、卡片类型和指标顺序。数据卡可从 28 项指标中选择。温度和压力分别设置颜色阈值，OBD 共存开关对两种仪表模式同时生效。完整参数见[仪表说明](../README.md)。

## 配置保存

共享模型在仓库根目录的 `settings.js`，构建时复制到 `cid-settings/src/settings.js`。设置应用通过本地 Unix socket 读写配置。manager 将配置原子写盘后，通过 IPC 通知仪表立即重绘。配置文件与 G 历史、组件选择记录分开保存。

- 车端配置文件为 `/var/opt/id8-widgets/state/club-dashboard-settings.json`。
- 车端 socket 为 `/var/opt/id8-widgets/state/club-dashboard-settings.sock`。部署时需要同时更新提供该服务的 manager、runtime、preferences 和仪表组件。

## 构建与检查

在仓库根目录运行 `node cid-settings/lifecycle.test.js` 可检查触摸、旋钮、图形协议、RHMI 回退和两种屏宽下的控件布局。运行 `node settings.test.js` 可检查设置迁移、Unix socket 和落盘。

运行 `python3 cid-settings/build.py` 会生成应用目录和源码包。构建使用 MGU Store 的 ID8 模板与打包工具、idrive7-apps 的绘图库和字体工具，以及 Pillow、fontTools 和中文字库。可用 `SETTINGS_CJK_FONT` 指定字体。

| 环境变量 | 默认位置（相对本目录） | 用途 |
| --- | --- | --- |
| `MGU_STORE` | `../../mgu-store` | 原生应用模板与打包工具 |
| `IDRIVE7_APPS` | `../../idrive7-apps` | 绘图库与字体工具 |
| `DASHBOARD_DIR` | `..` | 共享配置模型与俱乐部标志 |
