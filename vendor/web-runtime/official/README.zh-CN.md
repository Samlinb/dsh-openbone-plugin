# OpenBone 与 Spine 官方 WebGL 集成

[English](README.md) | [简体中文](README.zh-CN.md)

按用户 2026-10-28 的明确授权，下载并使用官方 `4.3/spine-ts`。OpenBone 自身以本机最新源码为准。上游源码位于 `target/spine-runtimes-4.3`，提交号 `ee2a10936a103ac187d74f7709f855653e923eae`。

约束、裁剪、linked mesh、sequence、双色、继承与混合直接调用官方实现，不以 Java 预览作为 Web 缺失功能的替代。固定依赖为 `spine-webgl` 4.2.120 与 4.3.13，4.2／4.3 数据分别交给匹配的 reader；不伪改数据版本。

```powershell
npm.cmd --prefix web-runtime/official ci --ignore-scripts --no-audit --no-fund
npm.cmd --prefix web-runtime/official run build
npm.cmd --prefix web-runtime run demo
```

打开 <http://127.0.0.1:8127/web-runtime/official/>。内置示例使用本项目诊断贴图，展示序列播放、linked mesh 变形继承及双色动画。播放器默认英语，并有简体／繁体中文控件。

嵌入 API：`loadOfficial(canvas,url)`、`setAnimation`、`mixTo`、`setTrack`、`setSkin`、`seek`、`update`、`render`、`capture`、`dispose`。同时公开原生 `sdk/data/skeleton/state/scene`，保留官方完整 API。跳转与换皮肤会重建原生对象；直接修改原生对象不自动加入包装层的重放记录。类型与完整示例见英文说明。

`current.json` 包先完成 manifest／资源哈希验证再解析。固定包版本、完整性哈希和版权许可一并保留，播放时无需联网下载 SDK。支持取消、贴图释放和重复销毁；物理按 60Hz 重放，子帧仅使用 pose，物理重放范围与 Java 保持 600 秒上限。

上游说明 WebGL/player 支持全部 Spine 功能；本次实际验收为 132 组 4.2／4.3 JSON／二进制浏览器渲染、可复现跳转，以及 sequence、linked mesh 变形、双色、跨动画混合、多轨叠加与命令重放。见 [功能矩阵](../CAPABILITIES.md) 和 `target/web-runtime-browser-receipt.json`。移动端、Safari、Firefox、上下文恢复及生产性能尚未验证。

官方允许免费评估；正式集成／分发须遵循 [Spine Runtime 许可](https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/LICENSE) 与相关 Editor 条款，并保留许可证和版权声明。本集成不代表已确认用户或分发者持有付费 Spine 授权。
