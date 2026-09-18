/*
 * ui.js — 界面交互层
 *
 * 只负责 DOM：编辑器行号同步、输出区、REPL、AST 面板、
 * 状态栏、测试结果渲染。所有解释器逻辑来自其它模块。
 */
(function (root) {
  "use strict";

  const ML = root.MiniLang;

  function initUI(opts) {
    const els = {
      editor: document.getElementById("editor"),
      gutter: document.getElementById("gutter"),
      output: document.getElementById("output"),
      repl: document.getElementById("repl-input"),
      runBtn: document.getElementById("btn-run"),
      clearBtn: document.getElementById("btn-clear"),
      exampleSel: document.getElementById("example-select"),
      testBtn: document.getElementById("btn-test"),
      astContent: document.getElementById("ast-content"),
      statusLex: document.getElementById("stat-lex"),
      statusParse: document.getElementById("stat-parse"),
      statusEval: document.getElementById("status-eval"),
      statusMode: document.getElementById("status-mode"),
    };

    /* ---------------- 行号同步 ---------------- */
    function syncGutter() {
      const lines = els.editor.value.split("\n").length;
      let html = "";
      for (let i = 1; i <= lines; i++) html += i + "\n";
      els.gutter.textContent = html;
      els.gutter.scrollTop = els.editor.scrollTop;
    }
    els.editor.addEventListener("scroll", function () {
      els.gutter.scrollTop = els.editor.scrollTop;
    });
    els.editor.addEventListener("input", syncGutter);

    /* ---------------- 输出区 ---------------- */
    function appendOutput(text, kind) {
      const div = document.createElement("div");
      div.className = "out-line" + (kind ? " out-" + kind : "");
      div.textContent = text;
      els.output.appendChild(div);
      els.output.scrollTop = els.output.scrollHeight;
      return div;
    }
    function clearOutput() {
      els.output.innerHTML = "";
    }

    function reportError(err, source) {
      const text = ML.formatError(err, source);
      text.split("\n").forEach(function (line, idx) {
        appendOutput(line, idx === 0 ? "error-head" : "error-body");
      });
    }

    /* ---------------- AST 文本树 ---------------- */
    function describeNode(node) {
      switch (node.type) {
        case "NumberLit":
          return "NumberLit " + ML.formatNumber(node.value);
        case "StringLit":
          return "StringLit " + JSON.stringify(node.value);
        case "BoolLit":
          return "BoolLit " + node.value;
        case "NullLit":
          return "NullLit";
        case "ArrayLit":
          return "ArrayLit (" + node.elements.length + " 项)";
        case "HashLit":
          return "HashLit (" + node.pairs.length + " 键)";
        case "Ident":
          return "Ident " + node.name;
        case "Unary":
          return "Unary '" + node.op + "'";
        case "Binary":
          return "Binary '" + node.op + "'";
        case "Logical":
          return "Logical '" + node.op + "'";
        case "Assign":
          return "Assign";
        case "Let":
          return "Let " + node.name;
        case "ExprStmt":
          return "ExprStmt";
        case "Block":
          return "Block (" + node.body.length + " 语句)";
        case "If":
          return "If" + (node.alternate ? " / Else" : "");
        case "While":
          return "While";
        case "FnDecl":
          return "FnDecl " + node.name + "(" + node.params.join(", ") + ")";
        case "FnExpr":
          return (
            "FnExpr " +
            (node.name || "<anonymous>") +
            "(" + node.params.join(", ") + ")"
          );
        case "Return":
          return "Return" + (node.value ? "" : " (空)");
        case "Break":
          return "Break";
        case "Continue":
          return "Continue";
        case "Call":
          return "Call (" + node.args.length + " 参)";
        case "Index":
          return "Index";
        case "Program":
          return "Program (" + node.body.length + " 语句)";
        default:
          return node.type;
      }
    }

    // 需要继续展开的子节点 / 子节点数组
    function childrenOf(node) {
      const kids = [];
      function pushKid(label, n) {
        if (n) kids.push({ label: label, node: n });
      }
      function pushList(label, list) {
        for (let i = 0; i < list.length; i++) {
          kids.push({ label: label + "[" + i + "]", node: list[i] });
        }
      }
      switch (node.type) {
        case "Program":
          pushList("body", node.body);
          break;
        case "Block":
          pushList("body", node.body);
          break;
        case "ArrayLit":
          pushList("el", node.elements);
          break;
        case "HashLit":
          node.pairs.forEach(function (pair, i) {
            kids.push({
              label: "key[" + i + "]=" + JSON.stringify(pair[0]),
              node: pair[1],
            });
          });
          break;
        case "Unary":
          pushKid("arg", node.arg);
          break;
        case "Binary":
        case "Logical":
          pushKid("left", node.left);
          pushKid("right", node.right);
          break;
        case "Assign":
          pushKid("target", node.target);
          pushKid("value", node.value);
          break;
        case "Let":
          pushKid("value", node.value);
          break;
        case "ExprStmt":
          pushKid("expr", node.expr);
          break;
        case "If":
          pushKid("test", node.test);
          pushKid("then", node.consequent);
          if (node.alternate) pushKid("else", node.alternate);
          break;
        case "While":
          pushKid("test", node.test);
          pushKid("body", node.body);
          break;
        case "FnDecl":
        case "FnExpr":
          pushKid("body", node.body);
          break;
        case "Return":
          pushKid("value", node.value);
          break;
        case "Call":
          pushKid("callee", node.callee);
          pushList("arg", node.args);
          break;
        case "Index":
          pushKid("obj", node.obj);
          pushKid("index", node.index);
          break;
      }
      return kids;
    }

    function renderAst(ast) {
      const lines = [];
      function walk(node, depth) {
        const loc = "  (" + node.pos.line + ":" + node.pos.col + ")";
        lines.push(
          "  ".repeat(depth) + describeNode(node) + loc
        );
        const kids = childrenOf(node);
        kids.forEach(function (kid) {
          lines.push("  ".repeat(depth + 1) + kid.label + ":");
          walk(kid.node, depth + 2);
        });
      }
      walk(ast, 0);
      els.astContent.textContent = lines.join("\n");
    }

    /* ---------------- 脚本运行 ---------------- */
    function setStatus(mode, lexMs, parseMs, evalMs) {
      els.statusMode.textContent = mode;
      els.statusLex.textContent =
        lexMs === null ? "—" : lexMs.toFixed(2) + " ms";
      els.statusParse.textContent =
        parseMs === null ? "—" : parseMs.toFixed(2) + " ms";
      els.statusEval.textContent =
        evalMs === null ? "—" : evalMs.toFixed(2) + " ms";
    }

    function runScript(source) {
      appendOutput("—— 运行脚本 ——", "meta");
      let ast = null;
      let lexMs = 0;
      let parseMs = 0;
      let evalMs = 0;

      // 词法阶段
      const t0 = performance.now();
      let tokens;
      try {
        tokens = ML.lex(source);
      } catch (err) {
        setStatus("词法错误", performance.now() - t0, null, null);
        reportError(err, source);
        return { ok: false };
      }
      lexMs = performance.now() - t0;

      // 语法阶段（parser 内部会再 lex 一次，这里用包裹方式单独计时）
      const t1 = performance.now();
      try {
        // parser.parse 内部包含 lex；为独立统计语法耗时，这里手动构造：
        // 直接调用 parse 得到 AST，词法耗时取第一次 lex 的结果作为近似。
        ast = parseFromTokens(tokens, source);
      } catch (err) {
        parseMs = performance.now() - t1;
        setStatus("语法错误", lexMs, parseMs, null);
        reportError(err, source);
        els.astContent.textContent = "（存在语法错误，无法生成 AST）";
        return { ok: false };
      }
      parseMs = performance.now() - t1;

      renderAst(ast);

      // 求值阶段（每次脚本运行使用全新环境）
      const t2 = performance.now();
      const env = ML.createGlobalEnv(function (text) {
        appendOutput(text, "print");
      });
      try {
        ML.evalProgram(ast, env);
      } catch (err) {
        evalMs = performance.now() - t2;
        setStatus("运行时错误", lexMs, parseMs, evalMs);
        reportError(err, source);
        return { ok: false };
      }
      evalMs = performance.now() - t2;
      setStatus("运行成功", lexMs, parseMs, evalMs);
      appendOutput(
        "—— 完成（词法 " + lexMs.toFixed(2) + " ms / 语法 " +
          parseMs.toFixed(2) + " ms / 求值 " + evalMs.toFixed(2) + " ms）——",
        "meta"
      );
      return { ok: true, ast: ast };
    }

    // 直接对已切分的 token 做解析：复用 parser 时重新 lex 对小脚本无感知，
    // 但为保证“语法耗时”不混入词法，这里暴露 parser 的 token 入口。
    function parseFromTokens(tokens, source) {
      return ML.parseTokens ? ML.parseTokens(tokens, source) : ML.parse(source);
    }

    /* ---------------- REPL（持久环境） ---------------- */
    const replEnv = ML.createGlobalEnv(function (text) {
      appendOutput(text, "print");
    });

    function runReplLine(raw) {
      const source = raw;
      appendOutput("> " + source, "repl-in");
      const trimmed = source.trim();
      if (trimmed === "") return;

      let ast;
      try {
        ast = ML.parse(source);
      } catch (err) {
        reportError(err, source);
        return;
      }
      try {
        const value = ML.evalProgram(ast, replEnv);
        if (lastStatementIsExpression(ast) && value !== undefined) {
          appendOutput("=> " + ML.inspect(value), "repl-out");
        }
      } catch (err) {
        reportError(err, source);
      }
    }

    function lastStatementIsExpression(ast) {
      const last = ast.body[ast.body.length - 1];
      return !!last && last.type === "ExprStmt";
    }

    /* ---------------- 自测渲染 ---------------- */
    function runAndRenderTests() {
      appendOutput("—— 运行内置自测 ——", "meta");
      let summary;
      try {
        summary = ML.runTests();
      } catch (e) {
        appendOutput("测试框架自身崩溃: " + (e && e.message), "error-head");
        return;
      }
      summary.results.forEach(function (r) {
        const div = document.createElement("div");
        div.className =
          "out-line test-" + (r.pass ? "pass" : "fail");
        div.textContent =
          (r.pass ? "PASS  " : "FAIL  ") + r.name +
          (r.detail ? "   (" + r.detail + ")" : "");
        els.output.appendChild(div);
      });
      const sum = document.createElement("div");
      sum.className =
        "out-line " + (summary.failed === 0 ? "test-summary-ok" : "test-summary-bad");
      sum.textContent =
        "共 " + summary.total + " 条：通过 " + summary.passed +
        "，失败 " + summary.failed;
      els.output.appendChild(sum);
      els.output.scrollTop = els.output.scrollHeight;
    }

    /* ---------------- 事件绑定 ---------------- */
    els.runBtn.addEventListener("click", function () {
      try {
        runScript(els.editor.value);
      } catch (e) {
        appendOutput("内部错误: " + (e && e.message), "error-head");
      }
    });
    els.clearBtn.addEventListener("click", clearOutput);
    els.testBtn.addEventListener("click", function () {
      try {
        runAndRenderTests();
      } catch (e) {
        appendOutput("测试运行异常: " + (e && e.message), "error-head");
      }
    });
    els.exampleSel.addEventListener("change", function () {
      const key = els.exampleSel.value;
      if (key && opts.examples && opts.examples[key]) {
        els.editor.value = opts.examples[key].code;
        syncGutter();
      }
      els.exampleSel.value = "";
    });

    // Ctrl/Cmd + Enter 在编辑器内运行脚本
    els.editor.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        try { runScript(els.editor.value); } catch (err) {
          appendOutput("内部错误: " + (err && err.message), "error-head");
        }
      }
    });

    // Enter 执行；Shift+Enter 换行
    els.repl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const text = els.repl.value;
        els.repl.value = "";
        try {
          runReplLine(text);
        } catch (err) {
          appendOutput("内部错误: " + (err && err.message), "error-head");
        }
      }
    });

    if (opts.initialCode) els.editor.value = opts.initialCode;
    syncGutter();
    setStatus("就绪", null, null, null);

    return {
      syncGutter: syncGutter,
      appendOutput: appendOutput,
      clearOutput: clearOutput,
      runScript: runScript,
      runReplLine: runReplLine,
      runAndRenderTests: runAndRenderTests,
    };
  }

  ML.initUI = initUI;
})(typeof window !== "undefined" ? window : globalThis);
