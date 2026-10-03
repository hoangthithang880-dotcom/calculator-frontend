# 演算台前端

HTML/CSS/原生 JavaScript 的静态网页。纸感浅色与深绿主题，左侧完整表达式及后端实时结果，右侧数据库计算手记。**前端没有数学求值器**，没有把历史保存在 localStorage 来假冒后端数据库。

## 在线演示

- 在线网页：https://hoangthithang880-dotcom.github.io/calculator-frontend/
- 前端仓库：https://github.com/hoangthithang880-dotcom/calculator-frontend
- 后端 API：https://hoangthithang880.pythonanywhere.com
- 后端健康检查：https://hoangthithang880.pythonanywhere.com/api/health
- 后端仓库：https://github.com/hoangthithang880-dotcom/calculator-backend

2026 年 10 月 3 日完成公网部署和实际验证。复合表达式计算、错误提示、历史记录保存、后端重新加载后的数据持久化，以及指定记录删除功能均运行正常。

## 本地启动

在此 README 所在目录：

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Windows 用 `py -3 -m http.server 8080 --bind 127.0.0.1`。打开 `http://127.0.0.1:8080`，另一个终端按后端 README 启动 `http://127.0.0.1:5001` 的 Flask API。不直接双击 index.html 使用 `file://`，否则浏览器来源与 CORS 不能按正常网页验证。

普通使用不需要 Node、npm、打包器或依赖安装。`package.json` 仅用于可选的浏览器自动化测试。

前端不创建数据库。后端首次启动会执行其src/schema.sql自动建立SQLite表，默认使用后端data/history.db；持久性与部署路径按后端README配置。

## 前后端连接配置

`src/config.js` 默认：

```javascript
window.CALC_CONFIG = {
  apiBaseUrl: 'https://hoangthithang880.pythonanywhere.com',
  previewDelay: 280,
  requestTimeout: 10000,
};
```

部署时将 apiBaseUrl 改为真实后端 **HTTPS** 根地址，不带 `/api`。后端 `CORS_ORIGINS` 同时设置为前端完整来源，如 `https://your-name.github.io`，**不包括仓库路径或结尾斜线**。

右上角齿轮可以设置当前浏览器的 API 地址；本地偏好优先于 config.js，因此修改配置后若仍连接旧地址，到齿轮重新设置。API 地址和主题保存在 localStorage；计算结果与历史仍从后端取得。HTTPS 页面不允许连接 HTTP API。

## 操作

- 数字、运算符、括号支持键盘输入/按钮输入；输入后约280ms向后端请求预览，不保存记录。
- Enter 或“计算并保存”向后端计算并写数据库；= 也可确认。AC / Esc 清空；退格删除光标前字符或选中内容。
- 确认后的数字开始新表达式；运算符可接着上次结果计算。原始表达式仍留在历史。
- ± 对整个当前表达式取负，例如 `1+2` → `-(1+2)`，不是只改变末尾数字。
- 展示区固定192px高；表达式字体从46px缩至18px，达到当前屏幕宽度容量或128字符就拒绝新输入；结果字体更小。浏览器窗口随后变窄时已有内容可能需要在输入框内移动光标查看。
- 历史每页6条，支持表达式/结果文字搜索、复用、单条真实删除；删除前会要求用户确认，防止误删。CSV 导出的是全部历史，不只是当前搜索结果。
- `%` 为数学百分数，`100+10%=100.1`；`^` 为有限整数幂；`sqrt(9)` 平方根；不支持 `sin`、变量、隐式乘法。

## 目录

```text
index.html            结构、可访问名称、说明与连接设置对话框
src/style.css         配色、网格、主题与手机布局
src/app.js            输入状态、接口、预览防乱序、历史渲染
src/config.js         后端地址和超时设置
src/favicon.svg       本项目的矢量图标
tests/browser-test.cjs 真实前后端端到端验收
```

历史内容通过 `textContent` 写入页面，不把 API 返回文字当 HTML 执行。网络超时/服务停止显示连接错误，不伪造本地计算结果。服务器共享历史，不提供账户隔离；仅适用于非敏感课程演示。

## 可选浏览器验收

需要 Node 22+、配套后端安装好虚拟环境，以及如下相邻目录：

```text
某个父目录/
├── calculator-frontend/
└── calculator-backend/.venv/
```

```bash
npm install
npx playwright install chromium
npm test
```

使用测试端口18080和15001、独立临时 SQLite，检查25项实际浏览器行为。可用 `CALC_TEST_PYTHON` 指定后端 Python 路径；Windows 请设置 `.venv\Scripts\python.exe`。输出到父目录 `docs/screenshots` 和 `docs/browser-test-results.json`，不读取正常数据库。测试会覆盖这些生成截图，不会覆盖你的源码。独立前端仓库 CI 只运行 JS 语法检查，不冒充已经执行跨仓库集成测试。

## 静态部署

GitHub Pages 示例：仓库根目录必须包含 index.html 和 src/；Settings → Pages 选择 main、`/(root)`，按实际界面启用。前端不需要 Build Command。HTTPS 后端另外部署，再编辑 config.js。仓库页面 URL **不是** API URL；提交博客需要真实公网网页入口，并从另一个设备验证计算、查询及单条删除。

前后端应按老师要求使用两个独立仓库。前端已部署至 GitHub Pages，后端已部署至 PythonAnywhere。在线版本已经通过浏览器实际验证计算、查询、历史记录持久化及单条删除功能。规范：[codestyle.md](codestyle.md)。API 原理：[MDN Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)。代码、样式为本项目编写，AI 辅助测试与生成。
