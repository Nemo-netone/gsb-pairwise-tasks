/*
 * main.js —— 入口模块
 *
 * 各功能模块通过全局命名空间 ML 组织（见 object.js 顶部关于 file://
 * 双击打开时 ES Module CORS 限制的说明）。本文件只做入口引导与全局
 * 兜底错误防护：任何脚本错误都不应使页面崩溃。
 *
 * 加载顺序（index.html）：
 *   object.js -> ast.js -> lexer.js -> parser.js -> builtins.js
 *   -> evaluator.js -> tests.js -> ui.js -> main.js
 */
(function (global) {
  "use strict";

  var ML = global.ML || (global.ML = {});

  // 全局兜底：理论上所有错误都已在运行管线内捕获；
  // 此处理仅作为最后一道防线，防止未预期异常冒泡到控制台。
  global.addEventListener("error", function (event) {
    if (event && event.error && event.error instanceof ML.object.LangError) {
      event.preventDefault();
    }
  });
  global.addEventListener("unhandledrejection", function (event) {
    if (event && event.reason instanceof ML.object.LangError) {
      event.preventDefault();
    }
  });

  ML.booted = true;
})(typeof window !== "undefined" ? window : globalThis);