# FoundFish · 基鱼

> 基金、大盘、股票、虚拟货币状态栏小应用。基于 Electron，支持 macOS / Windows / Linux。

FoundFish 是一个常驻状态栏的行情追踪工具：基金净值、沪深港美行情、板块资金流、加密货币价格、新闻快讯与汇率，一处汇总，随时可见。

## 功能

- **基金** — 持仓管理、净值走势、持仓明细、经理信息、收益统计
- **行情** — 沪深港美股票实时行情、K 线、分时、资金流向、北向资金
- **板块** — 行业/概念/地区板块排名与资金流
- **加密** — CoinGecko / CoinCap 数字货币行情
- **宏观** — 大盘指数、经济数据、国债收益率、汇率
- **资讯** — 东方财富新闻快讯与股吧动态
- **工具** — 壁纸/图标自定义、数据备份恢复、快捷键、代理配置

## 数据源

全部使用公开 Web API，无需注册、无需密钥：

- 基金：天天基金 pingzhongdata、东方财富数据中心
- 股票/指数/板块：东方财富 push2 / push2his 行情接口
- 虚拟货币：CoinGecko、CoinCap
- 新闻：东方财富新闻 API
- 时间：淘宝/苏宁公开时间 API

> 说明：上游的 `fundgz` 估值接口已于 2026 年 7 月停止服务。社区构建版本展示最新单位净值，盘中实时估值功能仅在官方发行版中提供。

## 下载

前往 [Releases](https://github.com/zdh903/foundfish/releases) 下载对应平台的安装包。

- macOS：`.dmg`（支持 Apple Silicon 与 Intel）
- Windows：`.exe`
- Linux：`.AppImage`

## 开发

要求：Node >= 22.8，pnpm >= 10.9

```bash
pnpm install

# 实时开发预览
pnpm dev

# 仅渲染页面（不启动 Electron 主进程，速度更快）
pnpm quick-preview-web

# 类型检查
./node_modules/.bin/tsc --noEmit

# 构建
pnpm build
```

打包 macOS 本地预览：

```bash
pnpm package-mac
open release/build/mac/FoundFish.app
```

应用默认以菜单栏模式运行（`LSUIElement=true`），启动后图标位于顶部状态栏，而非 Dock。

## 项目背景

上游项目 [Fishing Funds](https://github.com/1zilc/fishing-funds) 于 2026 年 2 月归档停止维护。FoundFish 基于其开源代码继续开发，将闭源数据层替换为公开 API 实现，并去除了自动更新外链与 WinGet 发布配置。

## 免责声明

本项目仅用于个人行情查看与技术学习，所有数据来自第三方公开接口，不保证准确性与实时性，**不构成任何投资建议**。因使用本项目产生的任何损失，作者不承担责任。

## 许可证

[GPL-3.0](./LICENSE)（继承自上游 Fishing Funds）
