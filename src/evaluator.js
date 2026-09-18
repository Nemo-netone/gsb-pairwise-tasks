/*
 * evaluator.js — 树遍历求值器
 *
 * 核心结构：
 *   Environment : 词法环境链（块级作用域），闭包通过函数保存定义时环境实现
 *   evaluate()  : 按 AST 节点类型分发
 *
 * 设计取舍：
 *   - return / break / continue 用控制流信号抛出，语义清晰且无返回值装箱
 *   - break / continue 使用单例，避免百万次循环中反复分配对象
 *   - 逻辑 && / || 在 AST 层即与算术分开（Logical 节点），天然短路
 *   - 数组用 JS Array、hash 用 MLHash(Map)，两者都是引用语义
 */
(function (root) {
  "use strict";

  const ML = root.MiniLang;

  /* ---------------------------------------------------------------- *
   * 词法环境
   * ---------------------------------------------------------------- */
  class Environment {
    constructor(parent) {
      this.parent = parent || null;
      this.vars = Object.create(null);
      // 输出通道随词法环境链传递，保证任何闭包内 print 都可达
      this.__output = parent ? parent.__output : function () {};
    }

    // 在当前作用域声明；同一作用域重复声明报错
    declare(name, value, pos) {
      if (Object.prototype.hasOwnProperty.call(this.vars, name)) {
        throw new ML.MLError(
          "RedeclarationError",
          "变量重复声明: " + name,
          pos ? pos.line : 0,
          pos ? pos.col : 0
        );
      }
      this.vars[name] = value;
    }

    has(name) {
      if (Object.prototype.hasOwnProperty.call(this.vars, name)) return true;
      return this.parent ? this.parent.has(name) : false;
    }

    get(name, pos) {
      if (Object.prototype.hasOwnProperty.call(this.vars, name)) {
        return this.vars[name];
      }
      if (this.parent) return this.parent.get(name, pos);
      throw new ML.UndefinedVariable(
        "使用了未声明的变量: " + name,
        pos ? pos.line : 0,
        pos ? pos.col : 0
      );
    }

    // 沿作用域链找到最近的声明并赋值
    set(name, value, pos) {
      if (Object.prototype.hasOwnProperty.call(this.vars, name)) {
        this.vars[name] = value;
        return value;
      }
      if (this.parent) return this.parent.set(name, value, pos);
      throw new ML.UndefinedVariable(
        "赋值前未声明变量: " + name,
        pos ? pos.line : 0,
        pos ? pos.col : 0
      );
    }
  }

  function createGlobalEnv(outputFn) {
    const env = new Environment(null);
    env.__output = outputFn || function () {};
    // 安装内置函数（print 的输出通道在调用时注入）
    for (const name of Object.keys(ML.builtins)) {
      if (name.indexOf("__") === 0) continue;
      env.declare(name, ML.builtins[name], { line: 0, col: 0 });
    }
    return env;
  }

  /* ---------------------------------------------------------------- *
   * 类型辅助
   * ---------------------------------------------------------------- */
  function asNumber(v, what, pos) {
    if (typeof v !== "number") {
      throw new ML.TypeError(
        what + " 需要 number，实际得到 " + ML.typeName(v),
        pos.line,
        pos.col
      );
    }
    return v;
  }

  function asBoolean(v, what, pos) {
    if (typeof v !== "boolean") {
      throw new ML.TypeError(
        what + " 需要 boolean，实际得到 " + ML.typeName(v),
        pos.line,
        pos.col
      );
    }
    return v;
  }

  /* ---------------------------------------------------------------- *
   * 运行入口
   *   runProgram : 执行整段程序，返回最后一个表达式语句的值（REPL 用）
   * ---------------------------------------------------------------- */
  function runProgram(ast, env) {
    let result = null;
    const body = ast.body;
    for (let i = 0; i < body.length; i++) {
      const stmt = body[i];
      const value = execStmt(stmt, env);
      if (stmt.type === "ExprStmt") result = value;
      else result = null;
    }
    return result;
  }

  function execBlock(node, env) {
    // 块内没有本层 let/fn 声明时，复用外层环境，避免热循环反复分配
    const scope = node.hasDecl ? new Environment(env) : env;
    const body = node.body;
    for (let i = 0; i < body.length; i++) {
      execStmt(body[i], scope);
    }
  }

  function execStmt(node, env) {
    switch (node.type) {
      case "Let": {
        const value = evalExpr(node.value, env);
        env.declare(node.name, value, node.pos);
        return null;
      }
      case "FnDecl": {
        const fn = new ML.MLFunction(node.name, node.params, node.body, env);
        env.declare(node.name, fn, node.pos);
        return null;
      }
      case "Block":
        execBlock(node, env);
        return null;
      case "ExprStmt":
        return evalExpr(node.expr, env);
      case "If": {
        const test = asBoolean(
          evalExpr(node.test, env),
          "if 条件",
          node.test.pos
        );
        if (test) execBlock(node.consequent, env);
        else if (node.alternate) execBlock(node.alternate, env);
        return null;
      }
      case "While": {
        const testNode = node.test;
        const bodyStmts = node.body.body;
        const bodyHasDecl = !!node.body.hasDecl;
        outer: while (asBoolean(evalExpr(testNode, env), "while 条件", testNode.pos)) {
          try {
            if (bodyHasDecl) {
              execBlock(node.body, env);
            } else {
              for (let bi = 0; bi < bodyStmts.length; bi++) {
                execStmt(bodyStmts[bi], env);
              }
            }
          } catch (sig) {
            if (sig === ML.BREAK_SIGNAL) break outer;
            if (sig === ML.CONTINUE_SIGNAL) continue outer;
            throw sig;
          }
        }
        return null;
      }
      case "Return": {
        const value = node.value ? evalExpr(node.value, env) : null;
        throw new ML.ReturnSignal(value);
      }
      case "Break":
        throw ML.BREAK_SIGNAL;
      case "Continue":
        throw ML.CONTINUE_SIGNAL;
      default:
        throw new ML.MLError(
          "InternalError",
          "未知语句节点: " + node.type,
          node.pos ? node.pos.line : 0,
          node.pos ? node.pos.col : 0
        );
    }
  }

  /* ---------------------------------------------------------------- *
   * 表达式求值
   * ---------------------------------------------------------------- */
  function evalExpr(node, env) {
    switch (node.type) {
      case "NumberLit":
        return node.value;
      case "StringLit":
        return node.value;
      case "BoolLit":
        return node.value;
      case "NullLit":
        return null;
      case "ArrayLit": {
        const arr = new Array(node.elements.length);
        for (let i = 0; i < node.elements.length; i++) {
          arr[i] = evalExpr(node.elements[i], env);
        }
        return arr;
      }
      case "HashLit": {
        const hash = new ML.MLHash();
        for (let i = 0; i < node.pairs.length; i++) {
          const pair = node.pairs[i];
          hash.map.set(pair[0], evalExpr(pair[1], env));
        }
        return hash;
      }
      case "Ident":
        return env.get(node.name, node.pos);

      case "Unary": {
        if (node.op === "-") {
          const v = evalExpr(node.arg, env);
          return -asNumber(v, "一元 '-'", node.arg.pos);
        }
        // ! 必须接收 boolean，避免隐式真值歧义
        const v = evalExpr(node.arg, env);
        return !asBoolean(v, "'!' 操作数", node.arg.pos);
      }

      case "Logical": {
        // 短路求值：只对需要 boolean 的一侧做类型检查
        const left = evalExpr(node.left, env);
        asBoolean(left, "'" + node.op + "' 左侧", node.left.pos);
        if (node.op === "&&") {
          if (!left) return false;
          const right = evalExpr(node.right, env);
          return asBoolean(right, "'&&' 右侧", node.right.pos);
        } else {
          if (left) return true;
          const right = evalExpr(node.right, env);
          return asBoolean(right, "'||' 右侧", node.right.pos);
        }
      }

      case "Binary":
        return evalBinary(node, env);

      case "FnExpr": {
        const fn = new ML.MLFunction(
          node.name,
          node.params,
          node.body,
          env
        );
        return fn;
      }

      case "Call":
        return evalCall(node, env);

      case "Index":
        return evalIndex(node, env);

      case "Assign":
        return evalAssign(node, env);

      default:
        throw new ML.MLError(
          "InternalError",
          "未知表达式节点: " + node.type,
          node.pos ? node.pos.line : 0,
          node.pos ? node.pos.col : 0
        );
    }
  }

  function evalBinary(node, env) {
    const op = node.op;
    const left = evalExpr(node.left, env);

    // == / != 允许跨类型：不同类型直接判不等
    if (op === "==" || op === "!=") {
      const right = evalExpr(node.right, env);
      const eq = equals(left, right);
      return op === "==" ? eq : !eq;
    }

    // 大小比较：number 与 number、string 与 string 可比较
    if (op === "<" || op === "<=" || op === ">" || op === ">=") {
      const right = evalExpr(node.right, env);
      const bothNum = typeof left === "number" && typeof right === "number";
      const bothStr = typeof left === "string" && typeof right === "string";
      if (!bothNum && !bothStr) {
        throw new ML.TypeError(
          "'" + op + "' 只能比较 number 与 number 或 string 与 string，实际为 " +
            ML.typeName(left) + " 与 " + ML.typeName(right),
          node.pos.line,
          node.pos.col
        );
      }
      if (op === "<") return left < right;
      if (op === "<=") return left <= right;
      if (op === ">") return left > right;
      return left >= right;
    }

    // + ：number + number 或 string + string
    if (op === "+") {
      const right = evalExpr(node.right, env);
      if (typeof left === "number" && typeof right === "number") {
        return left + right;
      }
      if (typeof left === "string" && typeof right === "string") {
        return left + right;
      }
      throw new ML.TypeError(
        "'+' 要求两个 number 或两个 string，实际为 " +
          ML.typeName(left) + " 与 " + ML.typeName(right),
        node.pos.line,
        node.pos.col
      );
    }

    // - * / % ：仅 number
    const right = asNumber(
      evalExpr(node.right, env),
      "'" + op + "' 右侧",
      node.right.pos
    );
    asNumber(left, "'" + op + "' 左侧", node.left.pos);

    switch (op) {
      case "-":
        return left - right;
      case "*":
        return left * right;
      case "/":
        if (right === 0) {
          throw new ML.DivisionByZero("除数为 0", node.pos.line, node.pos.col);
        }
        return left / right;
      case "%":
        if (right === 0) {
          throw new ML.DivisionByZero("对 0 取模", node.pos.line, node.pos.col);
        }
        return left % right;
    }
    throw new ML.MLError(
      "InternalError",
      "未知二元运算符: " + op,
      node.pos.line,
      node.pos.col
    );
  }

  function equals(a, b) {
    // null 只与 null 相等；其余依赖 deepEqual（数组/hash 按结构比较）
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a) || a instanceof ML.MLHash) return ML.deepEqual(a, b);
    return a === b;
  }

  /* ---------------------------------------------------------------- *
   * 函数调用
   * ---------------------------------------------------------------- */
  function evalCall(node, env) {
    const callee = evalExpr(node.callee, env);
    const args = new Array(node.args.length);
    for (let i = 0; i < node.args.length; i++) {
      args[i] = evalExpr(node.args[i], env);
    }

    if (callee instanceof ML.MLBuiltin) {
      // 第三个参数把输出通道交给 print
      return callee.fn(args, node.pos, env.__output);
    }

    if (callee instanceof ML.MLFunction) {
      if (args.length !== callee.params.length) {
        throw new ML.ArityError(
          "函数 " + (callee.name || "<anonymous>") + " 需要 " +
            callee.params.length + " 个参数，实际传入 " + args.length,
          node.pos.line,
          node.pos.col
        );
      }
      // 闭包：以定义时环境为父作用域
      const local = new Environment(callee.env);
      for (let i = 0; i < callee.params.length; i++) {
        local.declare(callee.params[i], args[i], { line: 0, col: 0 });
      }
      // 命名函数字面量：函数名仅在自身函数体内可见（用于递归）
      if (callee.name) {
        if (!callee.env.has(callee.name)) {
          local.declare(callee.name, callee, { line: 0, col: 0 });
        }
      }
      try {
        execBlock(callee.body, local);
      } catch (sig) {
        if (sig instanceof ML.ReturnSignal) return sig.value;
        // break/continue 若逃出循环（理论上 parser 已拦截），兜底报错
        if (sig === ML.BREAK_SIGNAL || sig === ML.CONTINUE_SIGNAL) {
          throw new ML.MLError(
            "SyntaxError",
            sig === ML.BREAK_SIGNAL
              ? "break 出现在循环之外"
              : "continue 出现在循环之外",
            node.pos.line,
            node.pos.col
          );
        }
        throw sig;
      }
      return null;
    }

    throw new ML.TypeError(
      "尝试调用一个非函数值: " + ML.typeName(callee),
      node.pos.line,
      node.pos.col
    );
  }

  /* ---------------------------------------------------------------- *
   * 索引读取：arr[i] / h["k"]
   * ---------------------------------------------------------------- */
  function evalIndex(node, env) {
    const obj = evalExpr(node.obj, env);
    const idx = evalExpr(node.index, env);

    if (Array.isArray(obj)) {
      if (typeof idx !== "number") {
        throw new ML.TypeError(
          "数组索引必须是 number，实际为 " + ML.typeName(idx),
          node.index.pos.line,
          node.index.pos.col
        );
      }
      if (!Number.isInteger(idx)) {
        throw new ML.TypeError(
          "数组索引必须是整数，实际为 " + idx,
          node.index.pos.line,
          node.index.pos.col
        );
      }
      if (idx < 0 || idx >= obj.length) {
        throw new ML.IndexOutOfBounds(
          "数组索引越界: " + idx + "（长度 " + obj.length + "）",
          node.index.pos.line,
          node.index.pos.col
        );
      }
      return obj[idx];
    }

    if (obj instanceof ML.MLHash) {
      if (typeof idx !== "string") {
        throw new ML.TypeError(
          "hash 键必须是 string，实际为 " + ML.typeName(idx),
          node.index.pos.line,
          node.index.pos.col
        );
      }
      if (!obj.map.has(idx)) {
        throw new ML.KeyError(
          "hash 中不存在键: " + idx,
          node.index.pos.line,
          node.index.pos.col
        );
      }
      return obj.map.get(idx);
    }

    throw new ML.TypeError(
      "只能对 array 或 hash 使用索引访问，实际为 " + ML.typeName(obj),
      node.obj.pos.line,
      node.obj.pos.col
    );
  }

  /* ---------------------------------------------------------------- *
   * 索引/标识符赋值
   * ---------------------------------------------------------------- */
  function evalAssign(node, env) {
    const target = node.target;
    if (target.type === "Ident") {
      const value = evalExpr(node.value, env);
      return env.set(target.name, value, target.pos);
    }

    // Index 赋值：先取出容器并校验，再写入
    const obj = evalExpr(target.obj, env);
    const idx = evalExpr(target.index, env);
    const value = evalExpr(node.value, env);

    if (Array.isArray(obj)) {
      if (typeof idx !== "number" || !Number.isInteger(idx)) {
        throw new ML.TypeError(
          "数组索引必须是整数，实际为 " + ML.inspect(idx),
          target.index.pos.line,
          target.index.pos.col
        );
      }
      if (idx < 0 || idx >= obj.length) {
        throw new ML.IndexOutOfBounds(
          "数组赋值索引越界: " + idx + "（长度 " + obj.length + "）",
          target.index.pos.line,
          target.index.pos.col
        );
      }
      obj[idx] = value;
      return value;
    }

    if (obj instanceof ML.MLHash) {
      if (typeof idx !== "string") {
        throw new ML.TypeError(
          "hash 键必须是 string，实际为 " + ML.typeName(idx),
          target.index.pos.line,
          target.index.pos.col
        );
      }
      obj.map.set(idx, value);
      return value;
    }

    throw new ML.TypeError(
      "只能对 array 或 hash 的元素赋值，实际为 " + ML.typeName(obj),
      target.obj.pos.line,
      target.obj.pos.col
    );
  }

  /* ---------------------------------------------------------------- *
   * 对外 API
   * ---------------------------------------------------------------- */
  ML.Environment = Environment;
  ML.createGlobalEnv = createGlobalEnv;
  ML.evalProgram = runProgram;
})(typeof window !== "undefined" ? window : globalThis);
