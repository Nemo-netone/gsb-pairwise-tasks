/*
 * main.js — 入口：内置示例与启动。
 */
(function (root) {
  "use strict";

  const ML = root.MiniLang;

  const EXAMPLES = {
    fib: {
      label: "递归斐波那契",
      code: [
        "// 递归计算斐波那契数列",
        "fn fib(n) {",
        "  if (n < 2) {",
        "    return n;",
        "  }",
        "  return fib(n - 1) + fib(n - 2);",
        "}",
        "",
        "let i = 0;",
        "while (i < 10) {",
        "  print(\"fib(\" + str(i) + \") =\", fib(i));",
        "  i = i + 1;",
        "}",
      ].join("\n"),
    },

    counter: {
      label: "闭包计数器",
      code: [
        "// makeCounter 返回一个闭包：各自持有独立的 count",
        "fn makeCounter(name) {",
        "  let count = 0;",
        "  fn tick() {",
        "    count = count + 1;",
        "    print(name, \"->\", count);",
        "    return count;",
        "  }",
        "  return tick;",
        "}",
        "",
        "let a = makeCounter(\"A\");",
        "let b = makeCounter(\"B\");",
        "a();",
        "a();",
        "a();",
        "b();",
        "print(\"A 当前:\", a());",
        "print(\"B 当前:\", b());",
      ].join("\n"),
    },

    bubble: {
      label: "冒泡排序",
      code: [
        "// 冒泡排序：数组是引用语义，排序原地生效",
        "fn bubbleSort(arr) {",
        "  let n = len(arr);",
        "  let i = 0;",
        "  while (i < n - 1) {",
        "    let j = 0;",
        "    while (j < n - 1 - i) {",
        "      if (arr[j] > arr[j + 1]) {",
        "        let tmp = arr[j];",
        "        arr[j] = arr[j + 1];",
        "        arr[j + 1] = tmp;",
        "      }",
        "      j = j + 1;",
        "    }",
        "    i = i + 1;",
        "  }",
        "  return arr;",
        "}",
        "",
        "let data = [5, 2, 9, 1, 7, 3, 8, 4, 6, 0];",
        'print("排序前:", str(data));',
        "bubbleSort(data);",
        'print("排序后:", str(data));',
      ].join("\n"),
    },

    million: {
      label: "百万循环求和（性能）",
      code: [
        "// 1,000,000 次 while 累加，输出结果与耗时",
        "let n = 1000000;",
        "let start = clock();",
        "let i = 0;",
        "let sum = 0;",
        "while (i < n) {",
        "  sum = sum + i;",
        "  i = i + 1;",
        "}",
        "let elapsed = clock() - start;",
        'print("0 .. 999999 之和 =", sum);',
        'print("百万循环耗时(ms):", elapsed);',
      ].join("\n"),
    },
  };

  function bootstrap() {
    const sel = document.getElementById("example-select");
    Object.keys(EXAMPLES).forEach(function (key) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = EXAMPLES[key].label;
      sel.appendChild(opt);
    });

    const ui = ML.initUI({
      examples: EXAMPLES,
      initialCode: EXAMPLES.fib.code,
    });

    // 自动化钩子（不影响正常使用）：
    //   #selftest      打开即跑全部自测
    //   #perf          打开即跑百万循环性能示例
    //   #demo=fib      打开即运行指定示例(fib/counter/bubble/million)
    if (location.hash.indexOf("selftest") !== -1) {
      ui.runAndRenderTests();
    }
    if (location.hash.indexOf("perf") !== -1) {
      ui.runScript(EXAMPLES.million.code);
    }
    const demoMatch = location.hash.match(/demo=([a-z]+)/);
    if (demoMatch && EXAMPLES[demoMatch[1]]) {
      ui.runScript(EXAMPLES[demoMatch[1]].code);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }

  ML.EXAMPLES = EXAMPLES;
})(typeof window !== "undefined" ? window : globalThis);
