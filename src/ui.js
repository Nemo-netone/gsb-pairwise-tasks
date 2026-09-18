/*
 * ui.js —— 界面控制层
 *
 * 负责：
 *   - 编辑器行号同步、运行脚本、清空输出、加载示例
 *   - REPL 输入（上下键历史）
 *   - 词法 / 语法 / 求值三段计时与状态栏
 *   - 错误的「行:列 + 出错行原文 + ^ 指向」可视化
 *   - AST 缩进文本树渲染
 *   - 运行内置测试并逐条展示
 */
(function (global) {
  "use strict";

  var ML = global.ML || (global.ML = {});

  /* ----------------------------- 示例程序 ---------------------------- */

  var EXAMPLES = {
    fib: [
      "// 递归斐波那契",
      "fn fib(n) {",
      "  if (n < 2) {",
      "    return n;",
      "  }",
      "  return fib(n - 1) + fib(n - 2);",
      "}",
      "",
      "let i = 0;",
      "while (i < 11) {",
      "  print(\"fib(\" + str(i) + \") =\", fib(i));",
      "  i = i + 1;",
      "}"
    ].join("\n"),

    counter: [
      "// 闭包计数器：两个计数器互不干扰，证明闭包捕获的是各自定义时的环境",
      "fn makeCounter(start) {",
      "  let count = start;",
      "  fn inc() {",
      "    count = count + 1;",
      "    return count;",
      "  }",
      "  return inc;",
      "}",
      "",
      "let a = makeCounter(0);",
      "let b = makeCounter(100);",
      "print(\"a:\", a(), a(), a());",
      "print(\"b:\", b(), b());",
      "print(\"a again:\", a());"
    ].join("\n"),

    bubble: [
      "// 冒泡排序（数组引用语义：函数内修改直接反映到原数组）",
      "fn sort(arr) {",
      "  let n = len(arr);",
      "  let i = 0;",
      "  while (i < n - 1) {",
      "    let j = 0;",
      "    while (j < n - 1 - i) {",
      "      if (arr[j] > arr[j + 1]) {",
      "        let t = arr[j];",
      "        arr[j] = arr[j + 1];",
      "        arr[j + 1] = t;",
      "      }",
      "      j = j + 1;",
      "    }",
      "    i = i + 1;",
      "  }",
      "  return arr;",
      "}",
      "",
      "let data = [5, 2, 9, 1, 7, 3, 8, 4, 6, 0];",
      "sort(data);",
      "print(data);"
    ].join("\n"),

    million: [
      "// 性能示例：while 循环累加 1,000,000 次",
      "let sum = 0;",
      "let i = 0;",
      "while (i < 1000000) {",
      "  sum = sum + i;",
      "  i = i + 1;",
      "}",
      "print(\"sum(0..999999) =\", sum);"
    ].join("\n")
  };

  /* --------------------------- 错误信息格式化 ------------------------- */

  function getSourceLine(source, line) {
    var lines = source.split("\n");
    return line >= 1 && line <= lines.length ? lines[line - 1] : "";
  }

  // 生成多行错误文本：标题行 + 出错行原文 + ^ 指向
  function formatError(error, source) {
    var pos = error.pos || { line: 1, col: 1 };
    var header = "[" + error.type + "] 第 " + pos.line + " 行, 第 " + pos.col + " 列：" + error.message;
    if (!source) return header;
    var lineText = getSourceLine(source, pos.line);
    var caret = "";
    for (var i = 1; i < pos.col; i++) {
      caret += " ";
    }
    caret += "^";
    return header + "\n" + lineText + "\n" + caret;
  }

  /* ----------------------------- AST 文本树 --------------------------- */

  function renderAst(node) {
    var lines = [];
    walk(node, "", true, lines);
    return lines.join("\n");
  }

  // 合成的叶子节点（用于展示函数参数列表等非 AST 子树信息）
  function leaf(text) {
    return { kind: "__leaf__", text: text };
  }

  function walk(node, prefix, isLast, lines) {
    var connector = prefix === "" ? "" : (isLast ? "└─ " : "├─ ");
    lines.push(prefix + connector + describe(node));
    var children = nodeChildren(node);
    var childPrefix = prefix + (prefix === "" ? "" : (isLast ? "   " : "│  "));
    for (var i = 0; i < children.length; i++) {
      walk(children[i].node, childPrefix, i === children.length - 1, lines);
    }
  }

  function nodeChildren(node) {
    var result = [];
    function add(label, child) {
      if (child) result.push({ label: label, node: child });
    }
    if (node.kind === "Fn" || node.kind === "FnExpr") {
      if (node.params.length > 0) {
        add("params", leaf("Params (" + node.params.join(", ") + ")"));
      }
    }
    switch (node.kind) {
      case "Program":
      case "Block":
        node.statements.forEach(function (s) { add("stmt", s); });
        break;
      case "Let": add("init", node.init); break;
      case "If": add("test", node.test); add("then", node.consequent); add("else", node.alternate); break;
      case "While": add("test", node.test); add("body", node.body); break;
      case "Fn": add("body", node.body); break;
      case "FnExpr": add("body", node.body); break;
      case "Return": add("value", node.value); break;
      case "ExprStmt": add("expr", node.expr); break;
      case "Array": node.elements.forEach(function (e) { add("elem", e); }); break;
      case "Hash": node.pairs.forEach(function (p) { add(p.key, p.value); }); break;
      case "Unary": add("arg", node.arg); break;
      case "Binary":
      case "Logical": add("left", node.left); add("right", node.right); break;
      case "Assign": add("target", node.target); add("value", node.value); break;
      case "Index": add("obj", node.obj); add("index", node.index); break;
      case "Call": add("callee", node.callee); node.args.forEach(function (a) { add("arg", a); }); break;
      default: break;
    }
    return result;
  }

  function describe(node) {
    if (node.kind === "__leaf__") return node.text;
    switch (node.kind) {
      case "Number": return "Number " + ML.object.formatNumber(node.value);
      case "String": return "String " + ML.object.quoteString(node.value);
      case "Bool": return "Bool " + node.value;
      case "Null": return "Null";
      case "Identifier": return "Identifier " + node.name;
      case "Let": return "Let " + node.name;
      case "Fn": return "Fn " + node.name + "(" + node.params.join(", ") + ")";
      case "FnExpr": return "FnExpr (" + node.params.join(", ") + ")";
      case "Binary": return "Binary '" + node.op + "'";
      case "Logical": return "Logical '" + node.op + "'";
      case "Unary": return "Unary '" + node.op + "'";
      case "Assign": return "Assign";
      case "Index": return "Index []";
      case "Call": return "Call (" + (node.args ? node.args.length : 0) + " args)";
      case "If": return "If";
      case "While": return "While";
      case "Return": return "Return";
      case "Break": return "Break";
      case "Continue": return "Continue";
      case "Array": return "Array (" + node.elements.length + ")";
      case "Hash": return "Hash (" + node.pairs.length + ")";
      case "Block": return "Block (" + node.statements.length + ")";
      case "ExprStmt": return "ExprStmt";
      case "Program": return "Program (" + node.statements.length + ")";
      default: return node.kind;
    }
  }
  /* ----------------------------- 运行管线 ----------------------------- */

  function now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  // 完整运行：词法 -> 语法 -> 求值。
  // 返回 { ok, output, error, timings, ast }，永不向外抛异常。
  function runSource(source, evaluator) {
    var timings = { lex: 0, parse: 0, eval: 0 };
    var t0 = now();
    var tokens;
    try {
      tokens = ML.lexer.tokenize(source);
    } catch (e) {
      return { ok: false, stage: "lex", error: e, timings: timings };
    }
    timings.lex = now() - t0;

    var t1 = now();
    var ast;
    try {
      ast = ML.parser.parse(tokens);
    } catch (e) {
      timings.parse = now() - t1;
      return { ok: false, stage: "parse", error: e, timings: timings };
    }
    timings.parse = now() - t1;

    var t2 = now();
    try {
      evaluator.runProgram(ast);
    } catch (e) {
      timings.eval = now() - t2;
      return { ok: false, stage: "eval", error: e, timings: timings, ast: ast };
    }
    timings.eval = now() - t2;
    return { ok: true, timings: timings, ast: ast };
  }

  /* ------------------------------ 控制器 ------------------------------ */

  function UI() {
    this.editor = document.getElementById("editor");
    this.lineNumbers = document.getElementById("lineNumbers");
    this.output = document.getElementById("output");
    this.replInput = document.getElementById("replInput");
    this.statusLex = document.getElementById("statLex");
    this.statusParse = document.getElementById("statParse");
    this.statusEval = document.getElementById("statEval");
    this.astPanel = document.getElementById("astPanel");
    this.astContent = document.getElementById("astContent");
    this.testPanel = document.getElementById("testPanel");
    this.testSummary = document.getElementById("testSummary");
    this.testContent = document.getElementById("testContent");

    // REPL 使用一个长期存活的求值器（变量 / 函数在会话内保留）
    this.replEvaluator = new ML.evaluator.Evaluator({
      write: this.appendOutputRaw.bind(this)
    });
    this.replHistory = [];
    this.historyIndex = -1;

    this.bindEvents();
    if (this.editor.value.trim() === "") {
      this.editor.value = EXAMPLES.fib;
    }
    this.syncLineNumbers();
    this.syncScroll();
  }

  // print 的写入回调。为减少运行中 DOM 操作，内容先进入缓冲区，
  // 在下一轮事件循环之前一次性刷新为一个文本块节点。
  UI.prototype.appendOutputRaw = function (text) {
    if (this._printBuffer === undefined) this._printBuffer = "";
    this._printBuffer += text + "\n";
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    var self = this;
    // 微任务足够早：同一次运行内多次 print 会合并，错误也能紧跟输出
    Promise.resolve().then(function () { self.flushPrintBuffer(); });
  };

  UI.prototype.flushPrintBuffer = function () {
    this._flushScheduled = false;
    if (this._printBuffer) {
      var node = document.createElement("div");
      node.className = "out-print";
      node.textContent = this._printBuffer.replace(/\n$/, "");
      this.output.appendChild(node);
      this._printBuffer = "";
      this.output.scrollTop = this.output.scrollHeight;
    }
  };

  UI.prototype.appendOutput = function (text, className) {
    var span = document.createElement("div");
    span.className = "out-line " + (className || "");
    span.textContent = text;
    this.output.appendChild(span);
    this.output.scrollTop = this.output.scrollHeight;
  };

  UI.prototype.appendOutputNode = function (node) {
    this.output.appendChild(node);
    this.output.scrollTop = this.output.scrollHeight;
  };

  UI.prototype.setStatus = function (timings, errorStage) {
    this.statusLex.textContent = "词法 " + timings.lex.toFixed(2) + " ms";
    this.statusParse.textContent = "语法 " + timings.parse.toFixed(2) + " ms";
    this.statusEval.textContent = "求值 " + timings.eval.toFixed(2) + " ms";
    [this.statusLex, this.statusParse, this.statusEval].forEach(function (el) {
      el.classList.remove("status-error");
    });
    if (errorStage === "lex") this.statusLex.classList.add("status-error");
    if (errorStage === "parse") this.statusParse.classList.add("status-error");
    if (errorStage === "eval") this.statusEval.classList.add("status-error");
  };

  UI.prototype.runScript = function () {
    var source = this.editor.value;
    // 每次脚本运行使用独立求值器（脚本之间互不污染）
    var evaluator = new ML.evaluator.Evaluator({
      write: this.appendOutputRaw.bind(this)
    });

    this.appendOutputNode(this.makeBanner("▶ 运行脚本"));
    var result = runSource(source, evaluator);
    this.flushPrintBuffer();

    this.setStatus(result.timings, result.ok ? null : result.stage);

    if (result.ok) {
      this.astContent.textContent = renderAst(result.ast);
      this.appendOutputNode(this.makeBanner(
        "✓ 完成（求值 " + result.timings.eval.toFixed(2) + " ms）", "ok"
      ));
    } else {
      if (result.ast) {
        this.astContent.textContent = renderAst(result.ast) + "\n\n（语法分析已完成，错误发生在求值阶段）";
      } else {
        this.astContent.textContent = "（" + result.stage + " 阶段失败，未生成 AST）";
      }
      var node = document.createElement("pre");
      node.className = "out-error";
      node.textContent = formatError(result.error, source);
      this.appendOutputNode(node);
    }
  };

  UI.prototype.makeBanner = function (text, className) {
    var div = document.createElement("div");
    div.className = "out-banner " + (className || "");
    div.textContent = text;
    return div;
  };

  UI.prototype.clearOutput = function () {
    this.output.textContent = "";
  };

  UI.prototype.loadExample = function (key) {
    if (!key || !EXAMPLES[key]) return;
    this.editor.value = EXAMPLES[key];
    this.syncLineNumbers();
    this.runScript();
  };

  /* ------------------------------- REPL ------------------------------- */

  UI.prototype.runRepl = function () {
    var source = this.replInput.value;
    if (source.trim() === "") return;
    this.replHistory.push(source);
    this.historyIndex = this.replHistory.length;

    var echo = document.createElement("div");
    echo.className = "repl-echo";
    echo.textContent = "minilang> " + source;
    this.appendOutputNode(echo);
    this.replInput.value = "";

    // REPL 允许输入表达式（自动回显）或语句
    var wrapped = source;
    var exprOnly = false;
    var trimmed = source.replace(/\s+$/, "");
    if (!/[;{}]\s*$/.test(trimmed)) {
      // 没有语句结束符，按表达式处理，自动 print
      wrapped = "print(" + source + ");";
      exprOnly = true;
    }

    try {
      var tokens = ML.lexer.tokenize(wrapped);
      var ast = ML.parser.parse(tokens);
      try {
        this.replEvaluator.runProgram(ast);
        this.flushPrintBuffer();
      } catch (e) {
        this.flushPrintBuffer();
        var node = document.createElement("pre");
        node.className = "out-error";
        node.textContent = formatError(e, wrapped);
        // 表达式模式下的列因包装产生偏移：还原为原始输入列（减 6："print("）
        if (exprOnly && e.pos && e.pos.col > 6) {
          var fixed = Object.create(e);
          fixed.pos = { line: e.pos.line, col: e.pos.col - 6 };
          node.textContent = formatError(fixed, source);
        }
        this.appendOutputNode(node);
      }
    } catch (e) {
      this.flushPrintBuffer();
      var parseNode = document.createElement("pre");
      parseNode.className = "out-error";
      if (exprOnly && e.pos && e.pos.col > 6) {
        var fixedPos = { line: e.pos.line, col: e.pos.col - 6 };
        var fixedErr = { type: e.type, message: e.message, pos: fixedPos };
        parseNode.textContent = formatError(fixedErr, source);
      } else {
        parseNode.textContent = formatError(e, source);
      }
      this.appendOutputNode(parseNode);
    }
  };

  /* ----------------------------- 行号同步 ----------------------------- */

  UI.prototype.syncLineNumbers = function () {
    var count = this.editor.value.split("\n").length;
    var html = "";
    for (var i = 1; i <= count; i++) {
      html += i + "\n";
    }
    this.lineNumbers.textContent = html;
  };

  UI.prototype.syncScroll = function () {
    this.lineNumbers.scrollTop = this.editor.scrollTop;
  };

  /* ------------------------------ 测试 -------------------------------- */

  UI.prototype.runTests = function () {
    var result = ML.tests.runTests();
    this.testPanel.classList.add("open");
    this.testPanel.classList.remove("panel-collapsed");

    this.testSummary.textContent =
      "共 " + result.total + " 条，通过 " + result.passed +
      " 条，失败 " + result.failed + " 条，耗时 " + result.elapsed + " ms";
    this.testSummary.className = result.failed === 0 ? "test-all-pass" : "test-has-fail";

    var frag = document.createDocumentFragment();
    result.results.forEach(function (entry, idx) {
      var row = document.createElement("div");
      row.className = "test-row " + (entry.pass ? "test-pass" : "test-fail");
      var head = document.createElement("span");
      head.className = "test-head";
      head.textContent = (entry.pass ? "PASS #" : "FAIL #") + (idx + 1) + " " + entry.name;
      row.appendChild(head);
      if (!entry.pass) {
        var detail = document.createElement("span");
        detail.className = "test-detail";
        detail.textContent = "失败详情：" + entry.detail;
        row.appendChild(detail);
      }
      frag.appendChild(row);
    });
    this.testContent.textContent = "";
    this.testContent.appendChild(frag);
  };

  /* ------------------------------ 事件 -------------------------------- */

  UI.prototype.bindEvents = function () {
    var self = this;

    document.getElementById("btnRun").addEventListener("click", function () {
      self.runScript();
    });
    document.getElementById("btnClear").addEventListener("click", function () {
      self.clearOutput();
    });
    document.getElementById("exampleSelect").addEventListener("change", function (e) {
      if (e.target.value) self.loadExample(e.target.value);
      e.target.value = "";
    });
    document.getElementById("btnTests").addEventListener("click", function () {
      self.runTests();
    });
    document.getElementById("astToggle").addEventListener("click", function () {
      self.astPanel.classList.toggle("panel-collapsed");
    });
    document.getElementById("testToggle").addEventListener("click", function () {
      self.testPanel.classList.toggle("panel-collapsed");
    });

    this.editor.addEventListener("input", function () {
      self.syncLineNumbers();
    });
    this.editor.addEventListener("scroll", function () {
      self.syncScroll();
    });
    // Ctrl/Cmd + Enter 运行脚本
    this.editor.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        self.runScript();
      }
    });

    this.replInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        self.runRepl();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (self.historyIndex > 0) {
          self.historyIndex--;
          self.replInput.value = self.replHistory[self.historyIndex];
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (self.historyIndex < self.replHistory.length - 1) {
          self.historyIndex++;
          self.replInput.value = self.replHistory[self.historyIndex];
        } else {
          self.historyIndex = self.replHistory.length;
          self.replInput.value = "";
        }
      }
    });
  };

  ML.ui = {
    EXAMPLES: EXAMPLES,
    formatError: formatError,
    renderAst: renderAst,
    runSource: runSource,
    UI: UI
  };

  // DOM 就绪后启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      global.__miniLangUI = new UI();
    });
  } else {
    global.__miniLangUI = new UI();
  }
})(typeof window !== "undefined" ? window : globalThis);
