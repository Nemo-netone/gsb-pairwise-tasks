/*
 * tests.js — 内置自测（无需任何测试框架）
 *
 * 每个用例：
 *   { name, run }  其中 run 调用下面提供的断言辅助函数。
 * evalCode 在独立全局环境中执行 MiniLang 代码并返回最后一个表达式的值；
 * print 输出被捕获到 prints 数组。
 */
(function (root) {
  "use strict";

  const ML = root.MiniLang;

  // 执行一段代码，返回 { value, prints, error }
  function runSource(source) {
    const prints = [];
    const env = ML.createGlobalEnv(function (text) {
      prints.push(text);
    });
    const ast = ML.parse(source);
    let error = null;
    let value = null;
    try {
      value = ML.evalProgram(ast, env);
    } catch (e) {
      error = e;
    }
    return { value: value, prints: prints, error: error, ast: ast };
  }

  function runTests() {
    const results = [];
    let passedCount = 0;

    function ok(name, detail) {
      results.push({ name: name, pass: true, detail: detail || "" });
      passedCount++;
    }
    function fail(name, detail) {
      results.push({ name: name, pass: false, detail: detail || "" });
    }
    // 通用：检查实际值是否与期望（JS 形式）一致
    function expectValue(name, source, expected) {
      try {
        const r = runSource(source);
        if (r.error) {
          fail(name, "运行报错: " + ML.formatError(r.error, source));
          return;
        }
        if (ML.deepEqual(r.value, expected)) ok(name);
        else {
          fail(
            name,
            "期望 " + ML.inspect(expected) + "，实际 " + ML.inspect(r.value)
          );
        }
      } catch (e) {
        fail(name, "解析/运行异常: " + (e && e.message));
      }
    }
    // 期望抛出指定错误类型，并可选校验行:列
    function expectError(name, source, errType, line, col) {
      let r;
      try {
        r = runSource(source);
      } catch (e) {
        r = { error: e };
      }
      if (!r.error) {
        fail(name, "本应抛出 " + errType + "，但执行成功");
        return;
      }
      const e = r.error;
      const typeOk = e.errorType === errType;
      const lineOk = line === undefined || e.line === line;
      const colOk = col === undefined || e.col === col;
      if (typeOk && lineOk && colOk) {
        ok(
          name,
          errType + " @ " + e.line + ":" + e.col
        );
      } else {
        fail(
          name,
          "期望 " + errType +
            (line ? " @" + line + ":" + col : "") +
            "，实际 " + e.errorType + " @" + e.line + ":" + e.col +
            " — " + e.message
        );
      }
    }
    function expectPrint(name, source, expectedLines) {
      try {
        const r = runSource(source);
        if (r.error) {
          fail(name, "运行报错: " + ML.formatError(r.error, source));
          return;
        }
        if (ML.deepEqual(r.prints, expectedLines)) ok(name);
        else {
          fail(
            name,
            "期望输出 " + ML.inspect(expectedLines) +
              "，实际 " + ML.inspect(r.prints)
          );
        }
      } catch (e) {
        fail(name, "解析/运行异常: " + (e && e.message));
      }
    }

    const T = [];
    function t(name, fn) { T.push({ name: name, fn: fn }); }

    /* ---------- 1. 运算符优先级与结合性 ---------- */
    t("乘除优先于加减", function () {
      expectValue("t01", "2 + 3 * 4", 14);
    });
    t("同级算术左结合", function () {
      expectValue("t02", "10 - 2 - 3", 5);
    });
    t("除模与乘同级左结合", function () {
      expectValue("t03", "20 / 5 % 3", 1);
    });
    t("比较低于算术", function () {
      expectValue("t04", "1 + 2 < 4", true);
    });
    t("相等比较低于加减", function () {
      expectValue("t05", "1 + 1 == 2", true);
    });
    t("&& 优先于 ||", function () {
      expectValue("t06", "true || false && false", true);
    });
    t("括号改变优先级", function () {
      expectValue("t07", "(2 + 3) * 4", 20);
    });
    t("一元负号优先于乘法", function () {
      expectValue("t08", "-2 * 3", -6);
    });
    t("连续一元负号", function () {
      expectValue("t09", "--5", 5);
    });
    t("负号与减法歧义正确解析", function () {
      expectValue("t10", "3 - -2", 5);
    });
    t("取模运算", function () {
      expectValue("t11", "10 % 3", 1);
    });
    t("比较链式按左结合解析", function () {
      expectValue("t12", "1 < 2 == true", true);
    });
    t("逻辑非优先级", function () {
      expectValue("t13", "!true == false", true);
    });

    /* ---------- 2. 短路求值 ---------- */
    t("&& 在左侧为 false 时短路", function () {
      expectValue(
        "t14",
        "let hit = false; false && (hit = true); hit",
        false
      );
    });
    t("|| 在左侧为 true 时短路", function () {
      expectValue(
        "t15",
        "let hit = false; true || (hit = true); hit",
        false
      );
    });
    t("&& 左侧为 true 时求值右侧", function () {
      expectValue(
        "t16",
        "let hit = false; true && (hit = true); hit",
        true
      );
    });
    t("短路右侧不发生除零错误", function () {
      expectValue("t17", "false && (1 / 0 == 1)", false);
    });

    /* ---------- 3. 变量与块级作用域 ---------- */
    t("let 基本赋值", function () {
      expectValue("t18", "let x = 42; x", 42);
    });
    t("块内 let 不污染外层", function () {
      expectValue(
        "t19",
        "let x = 1; { let x = 2; } x",
        1
      );
    });
    t("块内可读取外层变量", function () {
      expectValue("t20", "let x = 1; { x = 9; } x", 9);
    });
    t("同一作用域重复声明报错", function () {
      expectError(
        "t21",
        "let x = 1; let x = 2;",
        "RedeclarationError"
      );
    });
    t("不同块允许同名声明", function () {
      expectValue(
        "t22",
        "let x = 1; { let x = 2; } { let x = 3; } x",
        1
      );
    });
    t("使用未声明变量报 UndefinedVariable", function () {
      expectError("t23", "y + 1", "UndefinedVariable", 1, 1);
    });
    t("赋值未声明变量报 UndefinedVariable", function () {
      expectError("t24", "z = 5", "UndefinedVariable", 1, 1);
    });

    /* ---------- 4. 函数与闭包 ---------- */
    t("函数返回值", function () {
      expectValue(
        "t25",
        "fn add(a, b) { return a + b; } add(2, 3)",
        5
      );
    });
    t("无 return 返回 null", function () {
      expectValue("t26", "fn nop() { } nop()", null);
    });
    t("递归阶乘", function () {
      expectValue(
        "t27",
        "fn fact(n) { if (n <= 1) { return 1; } return n * fact(n - 1); } fact(5)",
        120
      );
    });
    t("闭包捕获并修改定义时环境", function () {
      expectValue(
        "t28",
        "fn make() { let c = 0; fn inc() { c = c + 1; return c; } return inc; } " +
          "let f = make(); f(); f()",
        2
      );
    });
    t("两个闭包各自独立捕获", function () {
      expectPrint(
        "t29",
        "fn make() { let c = 0; fn inc() { c = c + 1; return c; } return inc; } " +
          "let a = make(); let b = make(); print(a()); print(a()); print(b());",
        ["1", "2", "1"]
      );
    });
    t("函数作为参数传递", function () {
      expectValue(
        "t30",
        "fn apply(f, x) { return f(x); } fn dbl(n) { return n * 2; } apply(dbl, 21)",
        42
      );
    });
    t("函数作为返回值且记住参数", function () {
      expectValue(
        "t31",
        "fn adder(n) { fn inner(x) { return x + n; } return inner; } let add5 = adder(5); add5(10)",
        15
      );
    });
    t("实参数量错误报 ArityError", function () {
      expectError(
        "t32",
        "fn f(a) { return a; } f()",
        "ArityError"
      );
    });
    t("调用非函数报 TypeError", function () {
      expectError("t33", "let x = 1; x()", "TypeError");
    });
    t("return 只能在函数内（解析期）", function () {
      expectError("t34", "return 1;", "SyntaxError", 1, 1);
    });

    /* ---------- 5. 数组 ---------- */
    t("数组字面量与索引", function () {
      expectValue("t35", "let a = [10, 20, 30]; a[1]", 20);
    });
    t("数组元素赋值", function () {
      expectValue("t36", "let a = [1, 2]; a[0] = 9; a[0]", 9);
    });
    t("数组是引用语义", function () {
      expectValue(
        "t37",
        "let a = [1, 2]; let b = a; b[0] = 99; a[0]",
        99
      );
    });
    t("数组越界读报 IndexOutOfBounds", function () {
      expectError("t38", "let a = [1]; a[5]", "IndexOutOfBounds");
    });
    t("数组负索引报 IndexOutOfBounds", function () {
      expectError("t39", "let a = [1]; a[-1]", "IndexOutOfBounds");
    });
    t("数组越界写报 IndexOutOfBounds", function () {
      expectError("t40", "let a = [1]; a[2] = 3", "IndexOutOfBounds");
    });
    t("对 number 索引报 TypeError", function () {
      expectError("t41", "let n = 5; n[0]", "TypeError");
    });

    /* ---------- 6. hash ---------- */
    t("hash 读取与赋值", function () {
      expectValue(
        "t42",
        'let h = { "a": 1, "b": 2 }; h["b"] = 20; h["b"]',
        20
      );
    });
    t("hash 标识符键语法", function () {
      expectValue("t43", 'let h = { name: "mini" }; h["name"]', "mini");
    });
    t("hash 引用语义", function () {
      expectValue(
        "t44",
        'let h = { "x": 1 }; let g = h; g["x"] = 7; h["x"]',
        7
      );
    });
    t("hash 不存在的键报 KeyError", function () {
      expectError("t45", 'let h = {}; h["nope"]', "KeyError");
    });

    /* ---------- 7. 字符串 ---------- */
    t("字符串拼接", function () {
      expectValue("t46", '"foo" + "bar"', "foobar");
    });
    t("字符串转义 \\n \\t \\\\ \\\"", function () {
      expectPrint(
        "t47",
        'print("a\\tb\\nc\\\\d\\"e")',
        ['a\tb\nc\\d"e']
      );
    });
    t("非法转义报词法错误", function () {
      expectError("t48", '"a\\xb"', "SyntaxError");
    });
    t("未闭合字符串报词法错误并定位", function () {
      expectError("t49", 'let s = "abc', "SyntaxError", 1, 9);
    });

    /* ---------- 8. break / continue ---------- */
    t("break 提前退出循环", function () {
      expectValue(
        "t50",
        "let i = 0; while (i < 10) { if (i == 3) { break; } i = i + 1; } i",
        3
      );
    });
    t("continue 跳过本次迭代", function () {
      expectValue(
        "t51",
        "let i = 0; let s = 0; while (i < 5) { i = i + 1; if (i == 3) { continue; } s = s + i; } s",
        12
      );
    });
    t("循环作用域变量每轮重建", function () {
      expectValue(
        "t52",
        "let i = 0; let last = 0; while (i < 3) { let tmp = i; last = tmp; i = i + 1; } last",
        2
      );
    });
    t("break 不能跨函数", function () {
      expectError(
        "t53",
        "fn f() { break; }",
        "SyntaxError"
      );
    });

    /* ---------- 9. 内置函数 ---------- */
    t("print 多参数空格连接", function () {
      expectPrint("t54", 'print("a", 1, true)', ["a 1 true"]);
    });
    t("len 数组/字符串/hash", function () {
      expectValue("t55", 'len([1,2,3]) + len("abcd") + len({"a":1})', 8);
    });
    t("push 原地追加并返回数组", function () {
      expectValue("t56", "let a = [1]; push(a, 2); len(a)", 2);
    });
    t("type 各类型", function () {
      expectPrint(
        "t57",
        'print(type(1)); print(type("s")); print(type(true)); print(type(null)); print(type([1])); print(type({"a":1}));',
        ["number", "string", "boolean", "null", "array", "hash"]
      );
    });
    t("str 数字转字符串", function () {
      expectValue("t58", 'str(25)', "25");
    });
    t("num 字符串转数字", function () {
      expectValue("t59", 'num("42") + 8', 50);
    });
    t("num 非法字符串报 TypeError", function () {
      expectError("t60", 'num("abc")', "TypeError");
    });
    t("abs 与 floor", function () {
      expectValue("t61", "abs(-3) + floor(2.9)", 5);
    });
    t("abs 类型检查", function () {
      expectError("t62", 'abs("x")', "TypeError");
    });

    /* ---------- 10. 错误定位 ---------- */
    t("let x = ; 语法错误定位", function () {
      expectError("t63", "let x = ;", "SyntaxError", 1, 9);
    });
    t("多行错误行:列正确", function () {
      expectError(
        "t64",
        "let a = 1;\nlet b = 2;\nlet c = ;",
        "SyntaxError",
        3,
        9
      );
    });
    t("运行时错误带行:列", function () {
      expectError(
        "t65",
        "let a = [1];\nlet v = a[9];",
        "IndexOutOfBounds",
        2,
        11
      );
    });
    t("除零报 DivisionByZero", function () {
      expectError("t66", "let x = 1 / 0;", "DivisionByZero", 1, 11);
    });
    t("错误格式化包含 ^ 指向", function () {
      try {
        ML.parse("let x = ;");
        fail("t67", "本应抛错");
      } catch (e) {
        const text = ML.formatError(e, "let x = ;");
        if (text.indexOf("1:9") !== -1 && /^\s*\^$/m.test(text)) ok("t67");
        else fail("t67", "格式化结果缺少行列或 ^:\n" + text);
      }
    });
    t("非法字符词法错误", function () {
      expectError("t68", "let @ = 1;", "SyntaxError", 1, 5);
    });

    /* ---------- 11. 性能：百万累加 ---------- */
    t("while 百万累加结果正确", function () {
      const src =
        "let i = 0; let s = 0; " +
        "while (i < 1000000) { s = s + i; i = i + 1; } s";
      expectValue("t69", src, 499999500000);
    });
    t("while 百万累加 2 秒内完成", function () {
      const src =
        "let i = 0; let s = 0; " +
        "while (i < 1000000) { s = s + i; i = i + 1; } s";
      try {
        const env = ML.createGlobalEnv(function () {});
        const ast = ML.parse(src);
        const t0 = performance.now();
        ML.evalProgram(ast, env);
        const ms = performance.now() - t0;
        if (ms < 2000) ok("t70", "耗时 " + ms.toFixed(1) + " ms");
        else fail("t70", "耗时 " + ms.toFixed(1) + " ms，超过 2000 ms");
      } catch (e) {
        fail("t70", "执行异常: " + (e && e.message));
      }
    });

    /* ---------- 执行 ---------- */
    for (let i = 0; i < T.length; i++) {
      try {
        T[i].fn();
      } catch (e) {
        fail(T[i].name, "测试自身抛出异常: " + (e && e.message));
      }
    }

    return {
      results: results,
      total: results.length,
      passed: passedCount,
      failed: results.length - passedCount,
    };
  }

  ML.runTests = runTests;
})(typeof window !== "undefined" ? window : globalThis);
