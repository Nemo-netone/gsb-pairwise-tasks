/*
 * tests.js —— 内置自测
 *
 * runTests() 执行全部断言，返回：
 *   { results: [{name, pass, detail}], passed, failed, total, elapsed }
 * 每条用例独立运行一个 Evaluator，print 输出被捕获用于断言；
 * 错误类用例断言抛出的错误类型与「行:列」定位。
 * 任何用例自身的意外异常都会记为失败（绝不静默吞掉）。
 */
(function (global) {
  "use strict";

  var ML = global.ML || (global.ML = {});

  // 执行源码，返回 { output, error }
  function execute(source) {
    var output = [];
    var evaluator = new ML.evaluator.Evaluator({
      write: function (text) { output.push(text); }
    });
    var ast = ML.parser.parse(ML.lexer.tokenize(source));
    try {
      evaluator.runProgram(ast);
      return { output: output.join(""), error: null };
    } catch (e) {
      return { output: output.join(""), error: e };
    }
  }

  // 仅做语法分析（用于断言语法错误）
  function parseOnly(source) {
    try {
      ML.parser.parse(ML.lexer.tokenize(source));
      return { error: null };
    } catch (e) {
      return { error: e };
    }
  }

  var CASES = [
    {
      name: "算术与乘除优先于加减",
      fn: function () {
        var r = execute("print(2 + 3 * 4);");
        return r.output === "14" ? "" : "期望 14，实际 " + r.output;
      }
    },
    {
      name: "一元负号优先于乘法",
      fn: function () {
        var r = execute("print(-2 * 3); print(2 * -3);");
        return r.output === "-6-6" ? "" : "期望 -6-6，实际 " + r.output;
      }
    },
    {
      name: "圆括号改变优先级",
      fn: function () {
        var r = execute("print((2 + 3) * 4);");
        return r.output === "20" ? "" : "期望 20，实际 " + r.output;
      }
    },
    {
      name: "取模与左结合",
      fn: function () {
        var r = execute("print(10 - 3 - 2); print(17 % 5);");
        return r.output === "52" ? "" : "期望 52，实际 " + r.output;
      }
    },
    {
      name: "比较低于算术",
      fn: function () {
        var r = execute("print(2 + 3 > 4); print(1 == 2);");
        return r.output === "truefalse" ? "" : "期望 truefalse，实际 " + r.output;
      }
    },
    {
      name: "&& 高于 ||",
      fn: function () {
        // true || false && false  => true
        var r = execute("print(true || false && false);");
        return r.output === "true" ? "" : "期望 true，实际 " + r.output;
      }
    },
    {
      name: "&& 短路：右侧不求值",
      fn: function () {
        var r = execute("let hit=false; fn f(){hit=true; return 1;} false && f(); print(hit);");
        return r.output === "false" ? "" : "期望 false，实际 " + r.output;
      }
    },
    {
      name: "|| 短路：右侧不求值",
      fn: function () {
        var r = execute("let hit=false; fn f(){hit=true; return 1;} true || f(); print(hit);");
        return r.output === "false" ? "" : "期望 false，实际 " + r.output;
      }
    },
    {
      name: "逻辑短路返回操作数本身",
      fn: function () {
        var r = execute("print(0 || 42); print(1 && 7);");
        // 0 为真值（非 null/false），所以 0||42 返回 0
        return r.output === "07" ? "" : "期望 07，实际 " + r.output;
      }
    },
    {
      name: "字符串 + 拼接与转义",
      fn: function () {
        var r = execute('print("a\\tb\\nc" + " \\"x\\"");');
        return r.output === "a\tb\nc \"x\"" ? "" : "期望转义文本，实际 " + JSON.stringify(r.output);
      }
    },
    {
      name: "let 块级作用域遮蔽",
      fn: function () {
        var r = execute("let x=1; { let x=2; print(x); } print(x);");
        return r.output === "21" ? "" : "期望 21，实际 " + r.output;
      }
    },
    {
      name: "同作用域重复 let 报错",
      fn: function () {
        var r = execute("let x=1; let x=2; print(x);");
        return r.error && r.error.type === "RedeclarationError"
          ? "" : "期望 RedeclarationError，实际 " + (r.error ? r.error.type : "无错误");
      }
    },
    {
      name: "嵌套块可重复声明外层变量",
      fn: function () {
        var r = execute("let x=1; { let x=2; { let x=3; print(x); } print(x); } print(x);");
        return r.output === "321" ? "" : "期望 321，实际 " + r.output;
      }
    },
    {
      name: "使用未声明变量报运行时错误",
      fn: function () {
        var r = execute("print(missing);");
        return r.error && r.error.type === "UndefinedVariable"
          ? "" : "期望 UndefinedVariable，实际 " + (r.error ? r.error.type : "无错误");
      }
    },
    {
      name: "赋值未声明变量报错",
      fn: function () {
        var r = execute("y = 5;");
        return r.error && r.error.type === "UndefinedVariable"
          ? "" : "期望 UndefinedVariable，实际 " + (r.error ? r.error.type : "无错误");
      }
    },
    {
      name: "闭包计数器捕获定义时环境",
      fn: function () {
        var src = "fn make(){ let c=0; fn inc(){ c=c+1; return c;} return inc; }" +
                  "let a=make(); let b=make(); print(a()); print(a()); print(b());";
        var r = execute(src);
        return r.output === "121" ? "" : "期望 121（两个独立计数器），实际 " + r.output;
      }
    },
    {
      name: "函数作为参数与返回值",
      fn: function () {
        var src = "fn inc(x){return x+1;} fn twice(f,x){return f(f(x));} print(twice(inc,10));";
        var r = execute(src);
        return r.output === "12" ? "" : "期望 12，实际 " + r.output;
      }
    },
    {
      name: "递归斐波那契 fib(10)=55",
      fn: function () {
        var src = "fn fib(n){ if(n<2){return n;} return fib(n-1)+fib(n-2);} print(fib(10));";
        var r = execute(src);
        return r.output === "55" ? "" : "期望 55，实际 " + r.output;
      }
    },
    {
      name: "while + break",
      fn: function () {
        var r = execute("let i=0; while(true){ if(i==5){break;} i=i+1; } print(i);");
        return r.output === "5" ? "" : "期望 5，实际 " + r.output;
      }
    },
    {
      name: "while + continue 跳过累加",
      fn: function () {
        var r = execute("let i=0; let s=0; while(i<10){ i=i+1; if(i%2==0){continue;} s=s+i; } print(s);");
        // 1+3+5+7+9 = 25
        return r.output === "25" ? "" : "期望 25，实际 " + r.output;
      }
    },
    {
      name: "数组引用语义",
      fn: function () {
        var r = execute("let a=[1,2,3]; let b=a; b[0]=99; print(a[0]);");
        return r.output === "99" ? "" : "期望 99，实际 " + r.output;
      }
    },
    {
      name: "数组越界读取报 IndexOutOfBounds",
      fn: function () {
        var r = execute("let a=[1,2]; print(a[5]);");
        return r.error && r.error.type === "IndexOutOfBounds"
          ? "" : "期望 IndexOutOfBounds，实际 " + (r.error ? r.error.type : "无错误");
      }
    },
    {
      name: "数组越界写入报 IndexOutOfBounds",
      fn: function () {
        var r = execute("let a=[1]; a[3]=9;");
        return r.error && r.error.type === "IndexOutOfBounds"
          ? "" : "期望 IndexOutOfBounds，实际 " + (r.error ? r.error.type : "无错误");
      }
    },
    {
      name: "对 number 索引访问报 TypeError",
      fn: function () {
        var r = execute("let n=5; print(n[0]);");
        return r.error && r.error.type === "TypeError"
          ? "" : "期望 TypeError，实际 " + (r.error ? r.error.type : "无错误");
      }
    },
    {
      name: "哈希读写与缺失键报错",
      fn: function () {
        var r = execute('let h={"a":1,"b":2}; h["c"]=3; print(h["a"]+h["c"]); print(h["nope"]);');
        return r.error && r.error.type === "KeyError" && r.output === "4"
          ? "" : "期望先输出 4 再抛 KeyError，实际 output=" + r.output + " err=" + (r.error && r.error.type);
      }
    },
    {
      name: "内置函数 len/push/type/str/num/abs/floor",
      fn: function () {
        var src = 'let a=[1,2]; push(a,3); print(len(a)); print(type(a)); print(type("s"));' +
                  ' print(num("41")+1); print(abs(-7)); print(floor(2.9)); print(len("abc"));' +
                  ' print(str(123)+"x");';
        var r = execute(src);
        var expected = '3arraystring42723123x';
        return r.output === expected ? "" : "期望 " + expected + "，实际 " + r.output;
      }
    },
    {
      name: "print 多参数与 null",
      fn: function () {
        var r = execute('print("x", 1, true, null);');
        return r.output === "x 1 true null" ? "" : "期望 'x 1 true null'，实际 " + r.output;
      }
    },
    {
      name: "语法错误带行:列定位：let x = ;",
      fn: function () {
        var r = parseOnly("let x = ;\n");
        if (!r.error) return "期望抛出语法错误";
        var okType = r.error.type === "SyntaxError";
        var okPos = r.error.pos && r.error.pos.line === 1 && r.error.pos.col === 9;
        return okType && okPos ? "" : "期望 SyntaxError@1:9，实际 " + r.error.type +
          "@" + (r.error.pos && r.error.pos.line) + ":" + (r.error.pos && r.error.col);
      }
    },
    {
      name: "顶层 return 报语法错误",
      fn: function () {
        var r = execute("return 1;");
        return r.error && r.error.type === "SyntaxError"
          ? "" : "期望 SyntaxError，实际 " + (r.error ? r.error.type : "无错误");
      }
    },
    {
      name: "break 跨函数边界报错",
      fn: function () {
        var r = execute("fn f(){ break; } f();");
        return r.error && r.error.type === "SyntaxError"
          ? "" : "期望 SyntaxError，实际 " + (r.error ? r.error.type : "无错误");
      }
    },
    {
      name: "循环内闭包捕获当轮变量 0/1/2",
      fn: function () {
        var src = "fn c(){ let fns=[]; let i=0;" +
                  " while(i<3){ let j=i; fn g(){return j;} push(fns,g); i=i+1; }" +
                  " return fns[0]()*100+fns[1]()*10+fns[2](); } print(c());";
        var r = execute(src);
        return r.output === "12" ? "" : "期望 12，实际 " + r.output;
      }
    },
    {
      name: "字符串 + number 报 TypeError",
      fn: function () {
        var r = execute('print("a" + 1);');
        return r.error && r.error.type === "TypeError"
          ? "" : "期望 TypeError，实际 " + (r.error ? r.error.type : "无错误");
      }
    },
    {
      name: "hash 内嵌数组仍为引用语义",
      fn: function () {
        var r = execute('let h={"k":[1,2]}; let a=h["k"]; a[1]=9; print(h["k"][1]);');
        return r.output === "9" ? "" : "期望 9，实际 " + r.output;
      }
    },
    {
      name: "运行时错误带行:列定位",
      fn: function () {
        var src = "let a=[1];\nprint(a[10]);";
        var r = execute(src);
        if (!r.error) return "期望抛出运行时错误";
        var okPos = r.error.pos && r.error.pos.line === 2;
        return okPos ? "" : "期望错误在第 2 行，实际 " + (r.error.pos && r.error.pos.line);
      }
    }
  ];

  function runTests() {
    var results = [];
    var start = (typeof performance !== "undefined" ? performance.now() : Date.now());
    for (var i = 0; i < CASES.length; i++) {
      var testCase = CASES[i];
      var entry = { name: testCase.name, pass: false, detail: "" };
      try {
        var detail = testCase.fn();
        entry.pass = detail === "";
        entry.detail = entry.pass ? "" : detail;
      } catch (e) {
        entry.pass = false;
        entry.detail = "测试自身异常：" + (e && e.message ? e.message : String(e));
      }
      results.push(entry);
    }
    var elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
    var passed = 0;
    for (var j = 0; j < results.length; j++) if (results[j].pass) passed++;
    return {
      results: results,
      passed: passed,
      failed: results.length - passed,
      total: results.length,
      elapsed: Math.round(elapsed)
    };
  }

  ML.tests = { runTests: runTests, CASES: CASES };
})(typeof window !== "undefined" ? window : globalThis);