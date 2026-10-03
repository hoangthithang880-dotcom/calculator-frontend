# 前端代码规范

采用 [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html) 的主要命名、缩进与声明约定，并按无构建课程项目约定如下。

- UTF-8、2空格缩进；语句结尾分号；字符串优先单引号；不可变引用优先 `const`，需要重新赋值用 `let`，不使用 `var`。
- 变量/函数 `camelCase`，HTML/CSS 类与id `kebab-case`。少量标准符号辅助函数 `$` 明确定义于 app.js 首行。
- 结构放 HTML，样式放 CSS，交互放 JS，连接参数放 config.js，不在每个按钮上写行内 onclick。
- Promise 用 async/await；网络调用集中到 apiRequest，界面事件不复制超时/CORS/错误判断。
- 动态历史的文字使用 textContent；仅固定、非用户输入的图标片段允许 innerHTML。
- 前端不得 `eval`/执行表达式，也不得把 localStorage 当计算历史主存储。
- CSS 用语义化变量管理主题，Grid 管理布局，媒体查询适配手机；常规宽度保持合理，简短CSS规则允许单行书写，复合JS语句可以在格式化时拆开。
- 图标控件需要 aria-label；消息用 aria-live/status；不能仅凭颜色说明错误；保留键盘焦点与 reduced-motion 支持。
- 不添加未使用的依赖；第三方代码/素材要注明来源；不得为规避查重混淆代码或假报原创来源。

最低检查：

```bash
node --check src/app.js
node --check src/config.js
```

这不是“完整通过所有 Google 风格 lint 规则”的声明；实际采用情况以上述项目约定和源码为准。
