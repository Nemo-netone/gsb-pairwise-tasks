/*
 * builtins.js — 内置函数与 str()/num() 转换语义。
 *
 * 所有内置函数统一签名 fn(args, pos)，pos 为调用点 { line, col }，
 * 抛出的错误都带行:列。
 *
 * 内置清单：
 *   print(...): 依次求值参数、用空格连接并输出（走 env.__io）
 *   len(v)    : 数组长度 / hash 键数 / 字符串字符数
 *   push(a,v) : 向数组末尾追加（原地修改），返回修改后的数组
 *   type(v)   : "number" | "string" | "boolean" | "null"
 *             | "array" | "hash" | "function"
 *   str(v)    : 转成字符串（字符串不带引号）
 *   num(v)    : 字符串/布尔/null/数字 -> number，非法则 TypeError
 *   abs(n)    : 绝对值
 *   floor(n)  : 向下取整
 *   clock()   : 当前时间毫秒数（用于性能测量；非规格强制项）
 */
(function (root) {
  "use strict";

  const ML = root.MiniLang;

  function arity(name, args, min, max) {
    if (max === undefined) max = min;
    if (args.length < min || args.length > max) {
      throw new ML.ArityError(
        name + "() 参数个数应为 " +
          (min === max ? min : min + "~" + max) +
          "，实际为 " + args.length,
        0,
        0
      );
    }
  }

  function toText(v) {
    if (typeof v === "string") return v;
    return ML.inspect(v);
  }

  // MiniLang 内部 num() 转换
  function convertNum(v, pos) {
    if (typeof v === "number") return v;
    if (v === null) return 0;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed === "") {
        throw new ML.TypeError("num(): 空字符串无法转为数字", pos.line, pos.col);
      }
      const n = Number(trimmed);
      if (Number.isNaN(n)) {
        throw new ML.TypeError(
          'num(): 无法把字符串 "' + trimmed + '" 转为数字',
          pos.line,
          pos.col
        );
      }
      return n;
    }
    throw new ML.TypeError(
      "num(): 无法把 " + ML.typeName(v) + " 转为数字",
      pos.line,
      pos.col
    );
  }

  const builtins = {
    print: new ML.MLBuiltin("print", function (args, pos, out) {
      const text = args.map(toText).join(" ");
      out(text);
      return null;
    }),

    len: new ML.MLBuiltin("len", function (args, pos) {
      arity("len", args, 1);
      const v = args[0];
      if (Array.isArray(v) || typeof v === "string") return v.length;
      if (v instanceof ML.MLHash) return v.map.size;
      throw new ML.TypeError(
        "len(): 参数必须是 array、string 或 hash，实际为 " + ML.typeName(v),
        pos.line,
        pos.col
      );
    }),

    push: new ML.MLBuiltin("push", function (args, pos) {
      arity("push", args, 2);
      const arr = args[0];
      if (!Array.isArray(arr)) {
        throw new ML.TypeError(
          "push(): 第一个参数必须是 array，实际为 " + ML.typeName(arr),
          pos.line,
          pos.col
        );
      }
      arr.push(args[1]);
      return arr;
    }),

    type: new ML.MLBuiltin("type", function (args, pos) {
      arity("type", args, 1);
      return ML.typeName(args[0]);
    }),

    str: new ML.MLBuiltin("str", function (args, pos) {
      arity("str", args, 1);
      return toText(args[0]);
    }),

    num: new ML.MLBuiltin("num", function (args, pos) {
      arity("num", args, 1);
      return convertNum(args[0], pos);
    }),

    abs: new ML.MLBuiltin("abs", function (args, pos) {
      arity("abs", args, 1);
      const v = args[0];
      if (typeof v !== "number") {
        throw new ML.TypeError(
          "abs(): 参数必须是 number，实际为 " + ML.typeName(v),
          pos.line,
          pos.col
        );
      }
      return Math.abs(v);
    }),

    floor: new ML.MLBuiltin("floor", function (args, pos) {
      arity("floor", args, 1);
      const v = args[0];
      if (typeof v !== "number") {
        throw new ML.TypeError(
          "floor(): 参数必须是 number，实际为 " + ML.typeName(v),
          pos.line,
          pos.col
        );
      }
      return Math.floor(v);
    }),

    clock: new ML.MLBuiltin("clock", function (args, pos) {
      arity("clock", args, 0);
      return Date.now();
    }),
  };

  ML.builtins = builtins;
  ML.convertNum = convertNum;
})(typeof window !== "undefined" ? window : globalThis);

