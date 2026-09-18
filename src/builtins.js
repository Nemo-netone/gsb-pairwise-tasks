/*
 * builtins.js —— 内置函数
 *
 * print / len / push / type / str / num / abs / floor
 * 内置函数通过 throw LangError 报告运行时错误；pos 由调用点传入。
 */
(function (global) {
  "use strict";

  var ML = global.ML || (global.ML = {});
  var O = ML.object;
  var LangError = O.LangError;
  var Builtin = O.Builtin;

  function arityError(name, expected, actual, pos) {
    throw new LangError(
      "ArityError",
      "内置函数 " + name + " 需要 " + expected + " 个参数，但得到 " + actual + " 个",
      pos
    );
  }

  function requireType(name, v, expected, pos) {
    if (O.typeName(v) !== expected) {
      throw new LangError(
        "TypeError",
        name + " 的参数必须是 " + expected + "，实际为 " + O.typeName(v),
        pos
      );
    }
  }

  var defs = {};

  // print(...)：参数以空格连接，字符串原样输出
  defs.print = new Builtin("print", function (args, pos, ctx) {
    var parts = args.map(function (v) { return O.toDisplayString(v); });
    ctx.write(parts.join(" "));
    return null;
  });

  // len：array -> 元素数；hash -> 键数；string -> 字符数
  defs.len = new Builtin("len", function (args, pos) {
    if (args.length !== 1) arityError("len", 1, args.length, pos);
    var v = args[0];
    if (typeof v === "string") return v.length;
    if (Array.isArray(v)) return v.length;
    if (O.isHash(v)) return v.size;
    throw new LangError(
      "TypeError",
      "len 的参数必须是 string、array 或 hash，实际为 " + O.typeName(v),
      pos
    );
  });

  // push(arr, v)：向数组末尾追加，原地修改，返回 null
  defs.push = new Builtin("push", function (args, pos) {
    if (args.length !== 2) arityError("push", 2, args.length, pos);
    var arr = args[0];
    if (!Array.isArray(arr)) {
      throw new LangError(
        "TypeError",
        "push 的第一个参数必须是 array，实际为 " + O.typeName(arr),
        pos
      );
    }
    arr.push(args[1]);
    return null;
  });

  // type(v)：类型名字符串
  defs.type = new Builtin("type", function (args, pos) {
    if (args.length !== 1) arityError("type", 1, args.length, pos);
    return O.typeName(args[0]);
  });

  // str(v)：转成字符串（字符串去掉引号，其余同 inspect）
  defs.str = new Builtin("str", function (args, pos) {
    if (args.length !== 1) arityError("str", 1, args.length, pos);
    return O.toDisplayString(args[0]);
  });

  // num(v)：number 原样；string 按十进制解析（前后允许空白）；
  // boolean -> 1/0；null -> 报错（避免静默）
  defs.num = new Builtin("num", function (args, pos) {
    if (args.length !== 1) arityError("num", 1, args.length, pos);
    var v = args[0];
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
      var text = v.trim();
      if (text === "") {
        throw new LangError("ValueError", 'num 无法将空字符串转为数字', pos);
      }
      var n = Number(text);
      if (isNaN(n)) {
        throw new LangError("ValueError", 'num 无法将 "' + v + '" 转为数字', pos);
      }
      return n;
    }
    throw new LangError(
      "TypeError",
      "num 无法把 " + O.typeName(v) + " 转为数字",
      pos
    );
  });

  defs.abs = new Builtin("abs", function (args, pos) {
    if (args.length !== 1) arityError("abs", 1, args.length, pos);
    requireType("abs", args[0], "number", pos);
    return Math.abs(args[0]);
  });

  defs.floor = new Builtin("floor", function (args, pos) {
    if (args.length !== 1) arityError("floor", 1, args.length, pos);
    requireType("floor", args[0], "number", pos);
    return Math.floor(args[0]);
  });

  ML.builtins = { defs: defs };
})(typeof window !== "undefined" ? window : globalThis);