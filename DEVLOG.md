# FoundFish (基鱼) 开发日志

基于已归档的 Fishing Funds Electron 基金应用二次开发。
位置：~/tools/foundfish

## v1.0

- 139个TS错误清零，恢复函数返回类型，修复38个函数签名，实现23个stub函数
- 修复 plain window 模式白屏：IPC handlers 注册、readText 绕过 CORS
- 修复日期显示差一天（UTC→本地时间）、基金详情页数据解析
- 钱包图标精简：40个 → 12个，3行4列，下拉菜单新增"管理"入口
- 主题色保持蓝色 #2c7df5

## 技术备忘

- 开发模式：`FOUNDFISH_PLAIN_PREVIEW=1 pnpm dev`
- TypeScript检查：`./node_modules/.bin/tsc --noEmit`
- 构建：`./node_modules/.bin/electron-vite build`
- tsc 已知无关错误：`index.ts(207) Property 'destroy' does not exist on ClientRequest`，可忽略
- push2.eastmoney.com 限流 → 用 61.push2.eastmoney.com
- IPC request 返回 `{ body, headers }`，readText 提取 `.body`
