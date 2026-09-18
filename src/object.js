/*
 * object.js — 运行时对象、错误类型、值判定与展示、错误格式化。
 *
 * 运行时值映射：
 *   number  -> JS number（64 位浮点）
 *   string  -> JS string
 *   boolean -> JS boolean
 *   null    -> JS null
 *   array   -> JS Array（元素为 MiniLang 运行时值）
 *   hash    -> MLHash（内部用 Map，键固定为 string）
 *   function-> MLFunction（闭包）或 MLBuiltin（内置函数）
 */
(function (root) {
  "use strict";

  const ML = (root.MiniLang = root.MiniLang || {});

  /* ------------------------------------------------------------------ *
   * hash / function / builtin 包装
   * ------------------------------------------------------------------ */
  class MLHash {
    constructor(pairs) {
      this.map = new Map();
      if (pairs) {
        for (let i = 0; i < pairs.length; i++) {
          this.map.set(pairs[i][0], pairs[i][1]);
        }
      }
    }
  }

  class MLFunction {
    constructor(name, params, body, env) {
      this.name = name;
      this.params = params;
      this.body = body; // Block 节点
      this.env = env; // 定义时的环境（闭包）
    }
  }

  class MLBuiltin {
    constructor(name, fn) {
      this.name = name;
      this.fn = fn; // fn(args, pos, evaluator) => value
    }
  }

  /* ------------------------------------------------------------------ *
   * 控制流信号
   *  - return 每次新建 ReturnSignal 以携带返回值；
   *  - break / continue 用单例，避免每次迭代分配对象。
   * ------------------------------------------------------------------ */
  class ReturnSignal {
    constructor(value) {
      this.value = value;
    }
  }
  const BREAK_SIGNAL = Object.freeze({ __mlBreak: true });
  const CONTINUE_SIGNAL = Object.freeze({ __mlContinue: true });

  /* ------------------------------------------------------------------ *
   * 错误类型（均带 line/col）
   * ------------------------------------------------------------------ */
  class MLError extends Error {
    constructor(type, message, line, col) {
      super(message);
      this.name = "MLError";
      this.errorType = type;
      this.line = line || 0;
      this.col = col || 0;
    }
  }
  class LexError extends MLError {
    constructor(message, line, col) {
      super("SyntaxError", message, line, col);
      this.name = "LexError";
      this.phase = "lex";
    }
  }
  class ParseError extends MLError {
    constructor(message, line, col) {
      super("SyntaxError", message, line, col);
      this.name = "ParseError";
      this.phase = "parse";
    }
  }
  class TypeError extends MLError {
    constructor(message, line, col) {
      super("TypeError", message, line, col);
      this.name = "TypeError";
    }
  }
  class UndefinedVariable extends MLError {
    constructor(message, line, col) {
      super("UndefinedVariable", message, line, col);
      this.name = "UndefinedVariable";
    }
  }
  class IndexOutOfBounds extends MLError {
    constructor(message, line, col) {
      super("IndexOutOfBounds", message, line, col);
      this.name = "IndexOutOfBounds";
    }
  }
  class KeyError extends MLError {
    constructor(message, line, col) {
      super("KeyError", message, line, col);
      this.name = "KeyError";
    }
  }
  class DivisionByZero extends MLError {
    constructor(message, line, col) {
      super("DivisionByZero", message, line, col);
      this.name = "DivisionByZero";
    }
  }
  class ArityError extends MLError {
    constructor(message, line, col) {
      super("ArityError", message, line, col);
      this.name = "ArityError";
    }
  }

  /* ------------------------------------------------------------------ *
   * 类型判定与 type(v) 内置
   * ------------------------------------------------------------------ */
  function typeName(v) {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "number") return "number";
    if (t === "string") return "string";
    if (t === "boolean") return "boolean";
    if (Array.isArray(v)) return "array";
    if (v instanceof MLHash) return "hash";
    if (v instanceof MLFunction || v instanceof MLBuiltin) return "function";
    return "unknown";
  }

  function isCallable(v) {
    return v instanceof MLFunction || v instanceof MLBuiltin;
  }

  function isInt(n) {
    return Number.isInteger(n);
  }

  /* ------------------------------------------------------------------ *
  * 值的展示（print / REPL 回显）
  *  - 整数不显示 ".0"，与 str() 的语言语义一致；
  *  - 字符串输出为原文（print("a") 输出 a，不带引号）；
  *  - REPL 中字符串回显带引号，数组/hash 递归展示。
  * ------------------------------------------------------------------ */
  function formatNumber(n) {
    if (Number.isNaN(n)) return "nan";
    if (!Number.isFinite(n)) return n > 0 ? "inf" : "-inf";
    return Number.isInteger(n) ? String(n) : String(n);
  }

  // 字符串字面量形态（带引号与转义），用于数组/hash 内部与 REPL 回显
  function reprString(s) {
    let out = '"';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') out += '\\"';
      else if (c === "\\") out += "\\\\";
      else if (c === "\n") out += "\\n";
      else if (c === "\t") out += "\\t";
      else if (c === "\r") out += "\\r";
      else out += c;
    }
    return out + '"';
  }

  function inspect(v, seen) {
    seen = seen || new Set();
    if (v === null) return "null";
    const t = typeof v;
    if (t === "number") return formatNumber(v);
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return reprString(v);
    if (Array.isArray(v)) {
      if (seen.has(v)) return "[...]";
      seen.add(v);
      const parts = v.map((el) => inspect(el, seen));
      seen.delete(v);
      return "[" + parts.join(", ") + "]";
    }
    if (v instanceof MLHash) {
      if (seen.has(v)) return "{...}";
      seen.add(v);
      const parts = [];
      for (const [k, val] of v.map) {
        parts.push(reprString(k) + ": " + inspect(val, seen));
      }
      seen.delete(v);
      return "{" + parts.join(", ") + "}";
    }
    if (v instanceof MLFunction) {
      return "<fn " + (v.name || "anonymous") + ">";
    }
    if (v instanceof MLBuiltin) {
      return "<builtin " + v.name + ">";
    }
    return String(v);
  }

  // 深度相等：用于自测断言；hash 按键值内容比较
  function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    if (a instanceof MLHash) {
      if (!(b instanceof MLHash) || a.map.size !== b.map.size) return false;
      for (const [k, v] of a.map) {
        if (!b.map.has(k) || !deepEqual(v, b.map.get(k))) return false;
      }
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * 错误格式化：类型 + 行:列 + 出错行原文 + ^ 指向
   * ------------------------------------------------------------------ */
  function formatError(err, source) {
    const line = err.line || 0;
    const col = err.col || 0;
    const header =
      (err.errorType || "Error") +
      " [" + line + ":" + col + "]: " +
      (err.message || "");
    const lines = source.split(/\r\n|\n|\r/);
    if (line >= 1 && line <= lines.length) {
      const srcLine = lines[line - 1];
      const caretIndent = " ".repeat(Math.max(0, col - 1)) + "^";
      return header + "\n" + srcLine + "\n" + caretIndent;
    }
    return header;
  }

  ML.MLHash = MLHash;
  ML.MLFunction = MLFunction;
  ML.MLBuiltin = MLBuiltin;
  ML.ReturnSignal = ReturnSignal;
  ML.BREAK_SIGNAL = BREAK_SIGNAL;
  ML.CONTINUE_SIGNAL = CONTINUE_SIGNAL;
  ML.MLError = MLError;
  ML.LexError = LexError;
  ML.ParseError = ParseError;
  ML.TypeError = TypeError;
  ML.UndefinedVariable = UndefinedVariable;
  ML.IndexOutOfBounds = IndexOutOfBounds;
  ML.KeyError = KeyError;
  ML.DivisionByZero = DivisionByZero;
  ML.ArityError = ArityError;
  ML.typeName = typeName;
  ML.isCallable = isCallable;
  ML.formatNumber = formatNumber;
  ML.inspect = inspect;
  ML.deepEqual = deepEqual;
  ML.formatError = formatError;
})(typeof window !== "undefined" ? window : globalThis);
