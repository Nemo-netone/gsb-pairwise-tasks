/*
 * object.js —— 运行时对象层
 *
 * 定义：
 *   - 词法环境 Env（块级作用域，基于作用域链 + 绑定压栈实现）
 *   - 用户函数对象 Func 与内置函数对象 Builtin
 *   - 控制流信号 ReturnSignal / BreakSignal / ContinueSignal
 *   - 运行时错误 LangError
 *   - 值类型判断 / 相等性 / 显示（inspect / toDisplayString）等工具
 *
 * 模块挂载到全局命名空间 ML 上（其余模块同此模式）。
 * 说明：浏览器以 file:// 双击打开时，原生 ES Module 的 import 会被
 * CORS 策略拦截；因此各模块采用「独立文件 + IIFE + ML 命名空间」方式组织，
 * 模块边界与依赖关系依然清晰，且零依赖、零构建、双击即用。
 */
(function (global) {
  "use strict";

  var ML = global.ML || (global.ML = {});

  /* ------------------------------------------------------------------ */
  /* 错误                                                               */
  /* ------------------------------------------------------------------ */

  // 运行时错误：type 为错误类型名（TypeError / IndexOutOfBounds 等），
  // pos 为 {line, col}，由求值器在抛出点自动补上。
  function LangError(type, message, pos) {
    this.name = "LangError";
    this.type = type || "RuntimeError";
    this.message = message;
    this.pos = pos || null;
  }
  LangError.prototype = Object.create(Error.prototype);
  LangError.prototype.constructor = LangError;

  // 语法错误（词法 / 语法阶段使用）
  function ParseError(message, pos) {
    this.name = "ParseError";
    this.type = "SyntaxError";
    this.message = message;
    this.pos = pos || null;
  }
  ParseError.prototype = Object.create(Error.prototype);
  ParseError.prototype.constructor = ParseError;

  /* ------------------------------------------------------------------ */
  /* 控制流信号（非 Error，避免捕获堆栈带来的开销）                      */
  /* ------------------------------------------------------------------ */

  function Signal(kind, value) {
    this.kind = kind; // "return" | "break" | "continue"
    this.value = value;
  }
  var RETURN = "return";
  var BREAK = "break";
  var CONTINUE = "continue";

  /* ------------------------------------------------------------------ */
  /* 词法环境                                                           */
  /* ------------------------------------------------------------------ */

  // parent 为外层环境；vars 使用无原型对象，保证标识符查找快速。
  // 块作用域通过「新建 Env + parent 指向外层」实现，闭包自然捕获父链。
  function Env(parent) {
    this.parent = parent || null;
    this.vars = Object.create(null);
  }

  // 声明一个绑定（let / 函数名 / 参数）。同一作用域重复声明返回 false。
  Env.prototype.define = function (name, value) {
    if (Object.prototype.hasOwnProperty.call(this.vars, name)) {
      return false;
    }
    this.vars[name] = value;
    return true;
  };

  // 沿作用域链查找。返回 {env, value} 或 null。
  Env.prototype.lookup = function (name) {
    for (var env = this; env !== null; env = env.parent) {
      if (Object.prototype.hasOwnProperty.call(env.vars, name)) {
        return { env: env, value: env.vars[name] };
      }
    }
    return null;
  };

  Env.prototype.get = function (name) {
    var hit = this.lookup(name);
    return hit === null ? UNDEFINED_SENTINEL : hit.value;
  };

  Env.prototype.set = function (name, value) {
    var hit = this.lookup(name);
    if (hit === null) return false;
    hit.env.vars[name] = value;
    return true;
  };

  // 捕获定义时刻的环境快照（每个节点复制为独立 Env，互不共享 record）
  Env.prototype.capture = function () {
    var snap = new Env(this.parent ? this.parent.capture() : null);
    for (var key in this.vars) {
      if (Object.prototype.hasOwnProperty.call(this.vars, key)) {
        snap.vars[key] = this.vars[key];
      }
    }
    return snap;
  };
  /* ------------------------------------------------------------------ */
  /* 函数对象                                                           */
  /* ------------------------------------------------------------------ */

  // node: 函数 AST 节点；env: 定义时环境（闭包）
  function Func(name, params, bodyNode, env) {
    this.type = "function";
    this.name = name || "<anonymous>";
    this.params = params;
    this.body = bodyNode;
    this.env = env;
  }

  function Builtin(name, fn) {
    this.type = "function";
    this.name = name;
    this.native = fn;
  }

  /* ------------------------------------------------------------------ */
  /* 值工具                                                             */
  /* ------------------------------------------------------------------ */

  var UNDEFINED_SENTINEL = { __undef: true };

  function typeName(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    switch (typeof v) {
      case "number": return "number";
      case "string": return "string";
      case "boolean": return "boolean";
      case "object":
        if (v instanceof Map) return "hash";
        if (v.type === "function") return "function";
        return "object";
      default: return typeof v;
    }
  }

  function isHash(v) {
    return v !== null && typeof v === "object" && v instanceof Map;
  }

  function isFunction(v) {
    return v !== null && typeof v === "object" && v.type === "function";
  }

  // 逻辑真值：null 与 false 为假，其余为真
  function truthy(v) {
    return v !== null && v !== false;
  }

  // == / != 语义：null 仅等于 null；其余按 JS 严格相等（不做隐式转换）
  function valuesEqual(a, b) {
    if (a === null || b === null) return a === null && b === null;
    return a === b;
  }

  function isIntIndex(n) {
    return typeof n === "number" && isFinite(n) && Math.floor(n) === n;
  }

  // 数字显示：整数不带小数点
  function formatNumber(n) {
    if (!isFinite(n)) return String(n); // Infinity / -Infinity / NaN
    if (Object.is(n, -0)) return "-0";
    if (Math.floor(n) === n && Math.abs(n) < 1e21) return String(n);
    return String(n);
  }

  // 字符串字面量风格（带引号与转义），用于 REPL 回显与错误信息
  function inspect(v, seen) {
    seen = seen || [];
    if (v === null) return "null";
    if (typeof v === "number") return formatNumber(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string") return quoteString(v);
    if (isFunction(v)) return "<function " + v.name + ">";
    if (seen.indexOf(v) !== -1) return "<circular>";
    seen.push(v);
    if (Array.isArray(v)) {
      var parts = v.map(function (item) { return inspect(item, seen); });
      return "[" + parts.join(", ") + "]";
    }
    if (isHash(v)) {
      var pairs = [];
      v.forEach(function (val, key) {
        pairs.push(quoteString(key) + ": " + inspect(val, seen));
      });
      return "{" + pairs.join(", ") + "}";
    }
    return String(v);
  }

  function quoteString(s) {
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      switch (ch) {
        case '"': out += '\\"'; break;
        case '\\': out += '\\\\'; break;
        case '\n': out += '\\n'; break;
        case '\t': out += '\\t'; break;
        case '\r': out += '\\r'; break;
        default: out += ch;
      }
    }
    return out + '"';
  }

  // print / str 的显示形式：字符串原样输出，null 输出 "null"
  function toDisplayString(v, seen) {
    if (typeof v === "string") return v;
    return inspect(v, seen);
  }

  ML.object = {
    LangError: LangError,
    ParseError: ParseError,
    Signal: Signal,
    RETURN: RETURN,
    BREAK: BREAK,
    CONTINUE: CONTINUE,
    UNDEFINED_SENTINEL: UNDEFINED_SENTINEL,
    Env: Env,
    Func: Func,
    Builtin: Builtin,
    typeName: typeName,
    isHash: isHash,
    isFunction: isFunction,
    truthy: truthy,
    valuesEqual: valuesEqual,
    isIntIndex: isIntIndex,
    formatNumber: formatNumber,
    inspect: inspect,
    quoteString: quoteString,
    toDisplayString: toDisplayString
  };
})(typeof window !== "undefined" ? window : globalThis);