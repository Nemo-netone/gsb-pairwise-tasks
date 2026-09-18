/*
 * evaluator.js —— 树遍历求值器
 *
 * 职责：
 *   - 执行 AST，维护词法环境（块级作用域 + 闭包）
 *   - 实现运算符语义（短路求值、字符串拼接、类型检查）
 *   - 数组 / 哈希的引用语义与边界检查
 *   - 把 return / break / continue 作为信号沿调用栈传播
 *
 * 性能取向：热路径（标识符查找、二元运算、循环）直接内联，
 * 值使用 JS 原生 number/string/boolean/null + Array/Map 表示。
 */
(function (global) {
  "use strict";

  var ML = global.ML || (global.ML = {});
  var O = ML.object;
  var LangError = O.LangError;
  var Signal = O.Signal;
  var Env = O.Env;
  var Func = O.Func;
  var UNDEFINED = O.UNDEFINED_SENTINEL;

  // ctx: { write: function(string) }，print 输出经此回调
  function Evaluator(ctx) {
    this.ctx = ctx || { write: function () {} };
    this.globalEnv = new Env(null);
    this.installBuiltins();
  }

  Evaluator.prototype.installBuiltins = function () {
    var defs = ML.builtins.defs;
    for (var name in defs) {
      if (Object.prototype.hasOwnProperty.call(defs, name)) {
        this.globalEnv.vars[name] = defs[name];
      }
    }
  };

  Evaluator.prototype.runProgram = function (program) {
    var result = this.execBlockStatements(program.statements, this.globalEnv);
    // 顶层出现 return / break / continue 是非法的（没有函数或循环承接）
    if (result instanceof Signal) {
      var stmt = program.statements.length ? program.statements[program.statements.length - 1] : null;
      throw this.error(
        "SyntaxError",
        result.kind + " 出现在非法位置（return 必须在函数内，break/continue 必须在循环内）",
        stmt ? stmt.pos : program.pos
      );
    }
    return null;
  };

  Evaluator.prototype.error = function (type, message, pos) {
    return new LangError(type, message, pos || null);
  };

  /* ------------------------------ 语句 ------------------------------ */

  // 顺序执行一组语句；返回值仅用于 return 信号透传
  Evaluator.prototype.execStatements = function (statements, env) {
    for (var i = 0; i < statements.length; i++) {
      var value = this.execStatement(statements[i], env);
      if (value instanceof Signal) return value;
    }
    return undefined;
  };

  Evaluator.prototype.execStatement = function (node, env) {
    switch (node.kind) {
      case "ExprStmt":
        this.eval(node.expr, env);
        return undefined;

      case "Let": {
        var value = node.init === null ? null : this.eval(node.init, env);
        if (!env.define(node.name, value)) {
          throw this.error(
            "RedeclarationError",
            '变量 "' + node.name + '" 在同一作用域中重复声明',
            node.pos
          );
        }
        return undefined;
      }

      case "Block":
        return this.execBlock(node, env);

      case "If": {
        var test = this.eval(node.test, env);
        if (O.truthy(test)) {
          return this.execStatement(node.consequent, env);
        } else if (node.alternate !== null) {
          return this.execStatement(node.alternate, env);
        }
        return undefined;
      }

      case "While":
        return this.execWhile(node, env);

      case "Fn": {
        var fn = new Func(node.name, node.params, node.body, this.functionEnv(env));
        if (!env.define(node.name, fn)) {
          throw this.error(
            "RedeclarationError",
            '函数 "' + node.name + '" 在同一作用域中重复声明',
            node.pos
          );
        }
        return undefined;
      }

      case "Return": {
        var ret = node.value === null ? null : this.eval(node.value, env);
        return new Signal(O.RETURN, ret);
      }

      case "Break":
        return new Signal(O.BREAK, null);

      case "Continue":
        return new Signal(O.CONTINUE, null);

      default:
        throw this.error("InternalError", "未知的语句节点: " + node.kind, node.pos);
    }
  };

  // 块语句：新建记录（作用域对象）执行，结束后恢复被遮蔽的绑定
  Evaluator.prototype.execBlock = function (node, parentEnv) {
    var env = new Env(parentEnv);
    var result = this.execStatements(node.statements, env);
    return result;
  };

  // 供「语句列表 + 已有环境」使用（程序顶层 / 函数体）
  Evaluator.prototype.execBlockStatements = function (statements, env) {
    return this.execStatements(statements, env);
  };

  Evaluator.prototype.execWhile = function (node, env) {
    // 循环体若是块，创建一次体作用域，每轮复用结构但需重置绑定。
    // 为语义简单可靠，每轮新建块环境（百万次循环下仍是轻量对象）。
    while (true) {
      var test = this.eval(node.test, env);
      if (!O.truthy(test)) break;
      var outcome = this.execStatement(node.body, env);
      if (outcome instanceof Signal) {
        if (outcome.kind === O.BREAK) break;
        if (outcome.kind === O.CONTINUE) continue;
        return outcome; // return 向外传播
      }
    }
    return undefined;
  };
  /* ------------------------------ 表达式 ---------------------------- */

  Evaluator.prototype.eval = function (node, env) {
    switch (node.kind) {
      case "Number":
        return node.value;
      case "String":
        return node.value;
      case "Bool":
        return node.value;
      case "Null":
        return null;
      case "Identifier":
        return this.evalIdentifier(node, env);
      case "Array":
        return this.evalArray(node, env);
      case "Hash":
        return this.evalHash(node, env);
      case "FnExpr":
        return new Func("<anonymous>", node.params, node.body, this.functionEnv(env));
      case "Unary":
        return this.evalUnary(node, env);
      case "Binary":
        return this.evalBinary(node, env);
      case "Logical":
        return this.evalLogical(node, env);
      case "Assign":
        return this.evalAssign(node, env);
      case "Index":
        return this.evalIndex(node, env, false);
      case "Call":
        return this.evalCall(node, env);
      default:
        throw this.error("InternalError", "未知的表达式节点: " + node.kind, node.pos);
    }
  };

  Evaluator.prototype.evalIdentifier = function (node, env) {
    var value = env.get(node.name);
    if (value === UNDEFINED) {
      throw this.error(
        "UndefinedVariable",
        '变量 "' + node.name + '" 尚未声明',
        node.pos
      );
    }
    return value;
  };

  Evaluator.prototype.evalArray = function (node, env) {
    var arr = new Array(node.elements.length);
    for (var i = 0; i < node.elements.length; i++) {
      arr[i] = this.eval(node.elements[i], env);
    }
    return arr;
  };

  Evaluator.prototype.evalHash = function (node, env) {
    var map = new Map();
    for (var i = 0; i < node.pairs.length; i++) {
      var pair = node.pairs[i];
      map.set(pair.key, this.eval(pair.value, env));
    }
    return map;
  };

  Evaluator.prototype.evalUnary = function (node, env) {
    var value = this.eval(node.arg, env);
    if (node.op === "-") {
      if (typeof value !== "number") {
        throw this.error(
          "TypeError",
          '一元 "-" 只能用于 number，实际为 ' + O.typeName(value),
          node.pos
        );
      }
      return -value;
    }
    // !
    return !O.truthy(value);
  };

  Evaluator.prototype.evalLogical = function (node, env) {
    // 短路求值：先算左值，按运算符决定是否计算右侧
    var left = this.eval(node.left, env);
    if (node.op === "&&") {
      if (!O.truthy(left)) return left;
      return this.eval(node.right, env);
    }
    // ||
    if (O.truthy(left)) return left;
    return this.eval(node.right, env);
  };

  Evaluator.prototype.evalBinary = function (node, env) {
    var op = node.op;
    var left = this.eval(node.left, env);

    // == != 支持任意类型（引用 / 严格相等语义）
    if (op === "==" || op === "!=") {
      var rightEq = this.eval(node.right, env);
      return op === "==" ? O.valuesEqual(left, rightEq) : !O.valuesEqual(left, rightEq);
    }

    var right = this.eval(node.right, env);

    // + ：数字相加 或 字符串拼接
    if (op === "+") {
      if (typeof left === "number" && typeof right === "number") return left + right;
      if (typeof left === "string" && typeof right === "string") return left + right;
      throw this.error(
        "TypeError",
        '"+" 两侧必须同为 number 或同为 string，实际为 ' +
          O.typeName(left) + " 与 " + O.typeName(right),
        node.pos
      );
    }

    // 其余算术与比较都要求 number
    if (typeof left !== "number" || typeof right !== "number") {
      throw this.error(
        "TypeError",
        '运算符 "' + op + '" 要求两个 number，实际为 ' +
          O.typeName(left) + " 与 " + O.typeName(right),
        node.pos
      );
    }

    switch (op) {
      case "-": return left - right;
      case "*": return left * right;
      case "/": return left / right; // IEEE754：除零得到 Infinity / NaN
      case "%": return left % right;
      case "<": return left < right;
      case "<=": return left <= right;
      case ">": return left > right;
      case ">=": return left >= right;
      default:
        throw this.error("InternalError", "未知的二元运算符 " + op, node.pos);
    }
  };

  // 读取 / 写入索引的公共逻辑：assign=true 时写入 writeValue
  Evaluator.prototype.accessIndex = function (node, env, writeValue, isWrite) {
    var target = this.eval(node.obj, env);
    var key = this.eval(node.index, env);

    if (Array.isArray(target)) {
      if (typeof key !== "number" || !O.isIntIndex(key) || key < 0) {
        throw this.error(
          "TypeError",
          "数组索引必须是非负整数，实际为 " + O.inspect(key),
          node.index.pos
        );
      }
      if (isWrite) {
        if (key > target.length) {
          throw this.error(
            "IndexOutOfBounds",
            "数组赋值越界：长度 " + target.length + "，索引 " + key,
            node.index.pos
          );
        }
        if (key === target.length) {
          target.push(writeValue); // 允许在尾端追加一格
        } else {
          target[key] = writeValue;
        }
        return writeValue;
      }
      if (key >= target.length) {
        throw this.error(
          "IndexOutOfBounds",
          "数组索引越界：长度 " + target.length + "，索引 " + key,
          node.index.pos
        );
      }
      return target[key];
    }

    if (O.isHash(target)) {
      if (typeof key !== "string") {
        throw this.error(
          "TypeError",
          "哈希键必须是 string，实际为 " + O.typeName(key),
          node.index.pos
        );
      }
      if (isWrite) {
        target.set(key, writeValue);
        return writeValue;
      }
      if (!target.has(key)) {
        throw this.error(
          "KeyError",
          '哈希不存在键 "' + key + '"',
          node.index.pos
        );
      }
      return target.get(key);
    }

    throw this.error(
      "TypeError",
      "只能对 array 或 hash 使用索引访问，实际为 " + O.typeName(target),
      node.obj.pos
    );
  };

  Evaluator.prototype.evalIndex = function (node, env) {
    return this.accessIndex(node, env, undefined, false);
  };

  Evaluator.prototype.evalAssign = function (node, env) {
    var value = this.eval(node.value, env);
    var target = node.target;
    if (target.kind === "Identifier") {
      if (!env.set(target.name, value)) {
        throw this.error(
          "UndefinedVariable",
          '赋值给未声明的变量 "' + target.name + '"（请先用 let 声明）',
          target.pos
        );
      }
      return value;
    }
    // Index
    return this.accessIndex(target, env, value, true);
  };

  /* ------------------------------ 函数调用 -------------------------- */

  // 函数（含匿名 fn 表达式）在「带块绑定」的环境中定义时，
  // 用快照固化定义时刻可见的绑定，保证闭包正确。
  // 函数定义在块作用域（非全局环境）中时，对当前环境做快照，
  // 使闭包固化定义时刻可见的绑定；全局 / 函数体内则直接复用父链。
  Evaluator.prototype.functionEnv = function (env) {
    if (env !== this.globalEnv) {
      return env.capture();
    }
    return env;
  };

  Evaluator.prototype.evalCall = function (node, env) {
    var callee = this.eval(node.callee, env);
    var args = new Array(node.args.length);
    for (var i = 0; i < node.args.length; i++) {
      args[i] = this.eval(node.args[i], env);
    }

    if (!O.isFunction(callee)) {
      throw this.error(
        "TypeError",
        "尝试调用一个非函数值，类型为 " + O.typeName(callee),
        node.callee.pos
      );
    }

    // 内置函数
    if (callee.native) {
      return callee.native(args, node.callee.pos, this.ctx);
    }

    // 用户函数：实参数量必须匹配
    if (args.length !== callee.params.length) {
      throw this.error(
        "ArityError",
        "函数 " + callee.name + " 需要 " + callee.params.length +
          " 个参数，但得到 " + args.length + " 个",
        node.callee.pos
      );
    }

    var local = new Env(callee.env);
    for (var p = 0; p < callee.params.length; p++) {
      if (!local.define(callee.params[p], args[p])) {
        throw this.error(
          "RedeclarationError",
          '参数 "' + callee.params[p] + '" 重复声明',
          node.pos
        );
      }
    }

    var outcome = this.execStatements(callee.body.statements, local);
    if (outcome instanceof Signal) {
      if (outcome.kind === O.RETURN) return outcome.value;
      // break / continue 穿出函数边界是非法的
      throw this.error(
        "SyntaxError",
        outcome.kind + " 出现在循环之外（不能跨函数使用）",
        node.pos
      );
    }
    return null; // 无 return 的函数返回 null
  };

  // 供 REPL / 顶层使用：在全局环境执行一条语句。
  // 返回 { signal, value }：value 为表达式语句的结果（用于 REPL 回显）。
  Evaluator.prototype.execReplLine = function (astNode) {
    if (astNode.kind === "Program") {
      var last = null;
      for (var i = 0; i < astNode.statements.length; i++) {
        var stmt = astNode.statements[i];
        if (stmt.kind === "ExprStmt") {
          last = this.eval(stmt.expr, this.globalEnv);
        } else {
          var out = this.execStatement(stmt, this.globalEnv);
          if (out instanceof Signal) {
            throw this.error(
              "SyntaxError",
              out.kind + " 出现在非法位置",
              stmt.pos
            );
          }
          last = undefined;
        }
      }
      return last;
    }
    return undefined;
  };

  ML.evaluator = { Evaluator: Evaluator };
})(typeof window !== "undefined" ? window : globalThis);
