# ID8 组件框架

组件负责绘图和自己的数据转换。注册、连接、仪表模式识别、车辆唤醒、选择记忆与恢复由共享代码处理。

## 组成

| 部分 | 实现 | 职责 |
| --- | --- | --- |
| 组件 | 各 App 的 render.js、widget.js、数据模块 | 绘图、数据订阅声明和转换 |
| 共享运行时 | runtime.js | 创建图片图层、识别普通/M 模式、刷新、替换布局、连接和退出 |
| 统一管理进程 | manager.js、lifecycle.js | 启动所有组件；只建立一份点火状态订阅 |
| 注册 | registry.js | 从 App 描述生成独立菜单入口；稳定分配 target、content、scene |
| 显示与恢复 | 修改后的 cluster-render | 每个布局记住一个选中组件；协调显示请求；300 毫秒恢复；持久化选择 |

管理进程向 cluster-render 发送一次 widget-wake，组件本身不发送唤醒请求。组件间共享一个 renderer，具有独立的菜单名称、预览图与内容标识。

## 一个组件需要提供的内容

app.json 同时供网页模拟器与车辆框架读取。以 87 Arcade 为例：

```json
{
  "id": "club-dashboard",
  "title": "87 Arcade",
  "target": "widget",
  "entry": "render.js",
  "vehicle": "widget.js",
  "preview": "assets/preview.png"
}
```

widget.js 提供三个接口：

```js
const { render } = require('./render');
const { definitions, VehicleData } = require('./vehicle-data');
module.exports = {
    render,
    signals: definitions,
    createData: () => new VehicleData()
};
```

signals 沿用当前组件的声明格式。数据对象提供 receive(field, payload) 和 snapshot(mode)，后者返回给 render(canvas, data)。mode 为 road 或 sport。Canvas 尺寸、图层位置和刷新由 runtime.js 统一设置。组件中无需出现 ClusterRender、focus、点火监听或恢复计时器。

87 Arcade 的 vehicle.js 是兼容旧启动方式的薄入口，WIDGET_RUNTIME 可指定已安装的公共 runtime.js。由 manager.js 启动时直接使用公共入口。

## 注册和稳定标识

在 Node 环境执行：

```sh
node framework/widgets/registry.js APPS_ROOT REGISTRY_JSON BASE_RENDERER_CONF GENERATED_RENDERER_CONF
```

输出文件的父目录须事先建立。BASE_RENDERER_CONF 使用本目录附带的 cluster-render.conf。生成结果包含原有配置与各组件的菜单配置，供 renderer 的 -c 参数加载。

87 Arcade 保留原有 widget/content/scene。新增组件由注册工具自动分配独立标识，注册记录先落盘，再发布配置。重新注册、增加其他组件或卸载后重装均保留原标识。已经卸载的标识保留在注册记录中，不分配给新组件。管理进程只启动应用目录中实际存在的组件。

注册文件属于部署状态，部署时应保留。组件开发者无需手工分配标识。

## 选择和恢复

每个仪表布局的选择为 layout → content。普通模式可选 A，M 模式可选 B。收到仪表的 contentShow 后，显示服务记录该选择并撤销其他自定义组件的保留请求。布局切换或唤醒只召回该布局所选的组件。

选择文件默认为：

```text
/var/opt/cluster-render/state/widget-selection.txt
```

通过 id8_widget_selection_path 可指定路径。使用临时文件、fsync 和原子替换保存。服务重新启动后，首次收到布局信息即可按保存记录安排恢复，该启动请求会保留等待原厂提示结束；提供方断开不会清除选择。组件未注册或尚未提供图层时不召回其他组件代替它。

Lifecycle 的 Front 实例只读订阅沿用 v2.3 的实车发现。进程首次收到 FULL_ON_USER_ON 即产生一次恢复事件。经历欢迎、告别、关机或休眠状态后，再进入 FULL_ON_USER_ON 产生下一轮恢复事件。重复的 FULL、娱乐/全开变化不反复触发。若显示连接握手尚未完成，事件保留到连接就绪；车辆再次进入关机过程则撤销旧事件。

普通模式切换、安全区恢复与点火恢复继续由显示服务统一处理。单次组件启动不主动改变选择。

## 车端部署组成

本次提供可运行源码和服务单元，尚未制作包含车辆 SDK 的独立安装包。SDK 与 SOME/IP 配置需使用车辆已有资源，不能从本源码仓库替代得到。

- 修改后的 cluster-render 启动器、cluster-render-idrive8、cluster_render_client.js 与生成的 renderer 配置。启动器也解析配置，必须同时更新，否则会拒绝 remember 等新设置。
- framework/widgets 下的公共运行时与 id8-widgets.service。
- apps 目录内的组件源码及其各自的 Canvas/signals SDK 和只读接口定义。
- 管理进程使用的 SDK 和 Lifecycle.powerStateDetailed 的 Front 实例只读定义。
- runtime.env 中配置 NODE_PATH 与 WIDGET_MANAGER_KIT，指向车上现有 SDK。
- renderer 的 systemd 启动参数应加载生成的配置；id8-widgets.service 启动 manager.js。
- 完成迁移后由 manager 启动组件。当前车端复用 club-dashboard.service 的已登记自启入口，run.sh 改为执行 manager，原单组件入口不再运行。若以后改用独立 id8-widgets.service，必须停用此旧入口，防止重复启动。

注册状态供部署进程维护。选择文件目录须允许 renderer 的 hmi_5000 写入，原 cluster-render.service 已创建其默认 state 目录。新服务应沿用项目现有 MGU 部署流程登记，不能只复制 systemd 单元而跳过车机的服务登记。

## 验证和当前状态

```sh
node framework/widgets/check.js
node vehicle-layout.test.js
node vehicle-data.test.js
make -C idrive-apps/native/cluster-render build/host/dcsm27_port_test
idrive-apps/native/cluster-render/build/host/dcsm27_port_test
```

本地验证覆盖两组件互斥、各布局独立选择、服务重新启动后从文件恢复、提供方重新连接、注册重复执行、稳定标识及统一电源监听。87 Arcade 已使用公共运行时完成本地图层检查。

2026-11-22 已在车上部署公共 manager/runtime/lifecycle 与组件注册配置。沿用已登记且启用的 club-dashboard.service，通过其 run.sh 启动 manager，避免另行登记重复自启入口。manager 已启动 87 Arcade，renderer 从文件加载了两个模式的选择，300ms 后请求显示并收到 DCSM shown。名称已配置为 87 Arcade，缩略图已部署完整 logo PNG。2026-11-23 用户确认隔夜断电后重新启动仍能恢复选择。两个真实组件切换、原厂页面手动选择后的保留，仍须实车回归。现有 DCSM hide/release 不能单独识别“用户选择原厂页面”和“系统临时覆盖”，该识别问题统一留在框架层处理。

## Renderer 补丁

../../patches/cluster-render-v3.patch 基于上游 88e8554b1d81593d85f8095b4f0c38213223990d，包含原 v2.3 与本次共享选择、配置注册和持久化改动。将补丁应用到该上游版本后构建。已应用补丁的工作区不能重复应用。若保留本仓库根目录应用结构，可将其链接到 apps 根目录的 club-dashboard 项，管理器通过 app.json 读取入口。

本次 Linux 专项端口测试及 ID8 二进制构建、137 个 RAMSES 导入检查通过。macOS 的完整 service_test 通过。Linux 的 service_test 仍失败于此前实验记录中也出现过的“and each repeat as the last frame whole again, newest id”视频重复帧用例。该项没有修改，不能宣称 Linux 全套测试通过。

## 组件驾驶状态（本地新增，尚未部署）

公共 runtime 向 createData(storage) 提供按组件 ID 隔离的原子文件存储，文件位于 /var/opt/id8-widgets/state/<id>.json。storage 带当前 boot ID。manager 复用已有 Lifecycle 订阅，将电源状态转发给组件的 data.powerState，不新增每组件订阅。

87 Arcade 用它保存本轮驾驶 G 值极值的凸包顶点。切换布局或同一次启动内重启组件保留极值轮廓；关机/休眠后下一次 FULL_ON_USER_ON 或 boot ID 改变开始新一轮。欢迎提示或重复 FULL 不清零。新一轮先清除旧加速度缓存，等待新信号。拖影仅保留最近 2 秒，不写入文件；只有极值轮廓扩展或驾驶状态变化时落盘。

本地独立进程存取、模式切换、轨迹过期、新驾驶清零与重启测试通过。真实车辆的本轮边界和极值轮廓保留尚未验证。部署这些新功能需同时更新 state.js、runtime.js、manager.js、lifecycle.js、widget.js、vehicle-data.js、g-history.js 和 render.js，不能只替换绘图文件。


## Widget 偏好设置（2026-11-27）

widget 的 app.json 可声明 `preferences` 指向其配置模型 JS，导出 `defaults/copy/validate`。manager 用公共 preferences.js 提供本地 socket 和原子磁盘保存；写入成功后通过 `widget-settings` IPC 更新子进程，runtime 将配置作为第三个参数传给 render。未声明的 widget 沿用原行为，组件身份、选择记忆与唤醒恢复链路不变。

87 Arcade 设置 App 的集成、路径和验证边界见 `../../cid-settings/README.md`。偏好设置与驾驶 G 历史分文件保存。配置服务必须与新 runtime 一起部署，不能只安装中控设置 App。
