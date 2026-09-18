/*
 * parser.js — 语法分析器（递归下降 + Pratt 优先级表达式）
 *
 * 文法概览：
 *   program     := statement*
 *   statement   := letStmt | fnStmt | ifStmt | whileStmt
 *                | returnStmt | breakStmt | continueStmt
 *                | block | exprStmt
 *   expression  按 Pratt 绑定力分层：
 *     ||  (1,1)  <  && (2,2)  <  比较 (3,3)  <  加减 (4,4)
 *     <  乘除模 (5,5)  <  一元 (6)  <  调用/索引后缀 (7)
 *
 * 解析期检查：
 *   - break / continue 只能出现在 while 循环体内（不能跨函数）
 *   - return 只能出现在函数体内
 *   - 赋值左侧必须是变量名或索引表达式
 */
(function (root) {
  "use strict";

  const ML = root.MiniLang;
  const TT = ML.TT;
  const N = ML.N;

  // 二元运算符绑定力（leftBinding, rightBinding）
  // Pratt 绑定力：数字越大优先级越高；左结合运算符右侧用 lbp + 1
  const BINARY_PRECEDENCE = {
    "||": 1,
    "&&": 2,
    "==": 3,
    "!=": 3,
    "<": 3,
    "<=": 3,
    ">": 3,
    ">=": 3,
    "+": 4,
    "-": 4,
    "*": 5,
    "/": 5,
    "%": 5,
  };
  const LOGICAL_OPS = Object.create(null);
  LOGICAL_OPS["&&"] = true;
  LOGICAL_OPS["||"] = true;

  function parseTokens(tokens, source) {
    let pos = 0;

    function peek() {
      return tokens[pos];
    }
    function next() {
      return tokens[pos++];
    }
    function atOp(value) {
      const t = peek();
      return t.kind === TT.OP && t.value === value;
    }
    function atKeyword(value) {
      const t = peek();
      return t.kind === TT.KEYWORD && t.value === value;
    }
    function isEOF() {
      return peek().kind === TT.EOF;
    }

    function expectOp(value) {
      const t = peek();
      if (t.kind !== TT.OP || t.value !== value) {
        throw new ML.ParseError(
          "期望运算符 '" + value + "'，但遇到 " + describe(t),
          t.line,
          t.col
        );
      }
      return next();
    }

    function expectKeyword(value) {
      const t = peek();
      if (t.kind !== TT.KEYWORD || t.value !== value) {
        throw new ML.ParseError(
          "期望关键字 '" + value + "'，但遇到 " + describe(t),
          t.line,
          t.col
        );
      }
      return next();
    }

    function expectIdent() {
      const t = peek();
      if (t.kind !== TT.IDENT) {
        throw new ML.ParseError(
          "期望标识符，但遇到 " + describe(t),
          t.line,
          t.col
        );
      }
      return next();
    }

    // 可选分号：在 } 或 EOF 前允许省略
    function consumeSemicolon() {
      if (atOp(";")) {
        next();
      } else if (!atOp("}") && !isEOF()) {
        const t = peek();
        throw new ML.ParseError(
          "期望 ';' 或语句结束，但遇到 " + describe(t),
          t.line,
          t.col
        );
      }
    }

    function describe(t) {
      if (t.kind === TT.EOF) return "文件末尾";
      if (t.kind === TT.KEYWORD) return "关键字 '" + t.value + "'";
      if (t.kind === TT.OP) return "运算符 '" + t.value + "'";
      if (t.kind === TT.IDENT) return "标识符 '" + t.value + "'";
      if (t.kind === TT.NUMBER) return "数字 " + t.value;
      if (t.kind === TT.STRING) return "字符串 \"" + t.value + "\"";
      return "未知 token";
    }

    // 栈中记录每层 while 开始时所处的函数深度，
    // 用于禁止 break/continue 跨函数跳转
    const loopFnStack = [];
    let functionDepth = 0;

    /* -------------------------------------------------------------- *
     * 语句
     * -------------------------------------------------------------- */
    function parseProgram() {
      const start = peek();
      const body = [];
      while (!isEOF()) body.push(parseStatement());
      return N.Program(body, { line: start.line, col: start.col });
    }

    function parseStatement() {
      const t = peek();
      if (t.kind === TT.KEYWORD) {
        switch (t.value) {
          case "let":
            return parseLet();
          case "fn":
            return parseFnDecl();
          case "if":
            return parseIf();
          case "while":
            return parseWhile();
          case "return":
            return parseReturn();
          case "break":
            return parseBreak();
          case "continue":
            return parseContinue();
        }
      }
      if (atOp("{")) return parseBlock();
      return parseExprStmt();
    }

    function parseBlock() {
      const open = expectOp("{");
      const body = [];
      while (!atOp("}") && !isEOF()) {
        body.push(parseStatement());
      }
      expectOp("}");
      const block = N.Block(body, { line: open.line, col: open.col });
      // 仅当块内存在本层声明时才需要独立作用域（求值器据此做热路径优化）
      block.hasDecl = body.some(function (st) {
        return st.type === "Let" || st.type === "FnDecl";
      });
      return block;
    }

    function parseLet() {
      const kw = expectKeyword("let");
      const nameTok = expectIdent();
      expectOp("=");
      const value = parseExpression();
      consumeSemicolon();
      return N.Let(nameTok.value, value, { line: kw.line, col: kw.col });
    }

    function parseFnDecl() {
      const kw = expectKeyword("fn");
      const nameTok = expectIdent();
      functionDepth++;
      let parsed;
      try {
        parsed = parseParamsAndBody();
      } finally {
        functionDepth--;
      }
      return N.FnDecl(nameTok.value, parsed.params, parsed.body, {
        line: kw.line,
        col: kw.col,
      });
    }

    // 供 fn 声明与匿名 fn 表达式共用
    function parseParamsAndBody() {
      expectOp("(");
      const params = [];
      if (!atOp(")")) {
        do {
          const pTok = expectIdent();
          if (params.indexOf(pTok.value) !== -1) {
            throw new ML.ParseError(
              "参数名重复: " + pTok.value,
              pTok.line,
              pTok.col
            );
          }
          params.push(pTok.value);
        } while (consumeComma());
      }
      expectOp(")");
      const body = parseBlock();
      return { params: params, body: body };
    }

    function consumeComma() {
      if (atOp(",")) {
        next();
        return true;
      }
      return false;
    }

    function parseIf() {
      const kw = expectKeyword("if");
      expectOp("(");
      const test = parseExpression();
      expectOp(")");
      const consequent = parseBlock();
      let alternate = null;
      if (atKeyword("else")) {
        next();
        if (atKeyword("if")) {
          alternate = N.Block([parseIf()], {
            line: peek().line,
            col: peek().col,
          });
        } else {
          alternate = parseBlock();
        }
      }
      return N.If(test, consequent, alternate, {
        line: kw.line,
        col: kw.col,
      });
    }

    function parseWhile() {
      const kw = expectKeyword("while");
      expectOp("(");
      const test = parseExpression();
      expectOp(")");
      loopFnStack.push(functionDepth);
      const body = parseBlock();
      loopFnStack.pop();
      return N.While(test, body, { line: kw.line, col: kw.col });
    }

    function parseReturn() {
      const kw = expectKeyword("return");
      if (functionDepth === 0) {
        throw new ML.ParseError(
          "return 只能出现在函数体内",
          kw.line,
          kw.col
        );
      }
      // return; 或 return 后直接跟 } / EOL
      let value = null;
      if (!atOp(";") && !atOp("}") && !isEOF()) {
        value = parseExpression();
      }
      consumeSemicolon();
      return N.Return(value, { line: kw.line, col: kw.col });
    }

    function parseBreak() {
      const kw = expectKeyword("break");
      const inSameFn =
        loopFnStack.length > 0 &&
        loopFnStack[loopFnStack.length - 1] === functionDepth;
      if (!inSameFn) {
        throw new ML.ParseError(
          "break 只能出现在当前函数的 while 循环体内",
          kw.line,
          kw.col
        );
      }
      consumeSemicolon();
      return N.Break({ line: kw.line, col: kw.col });
    }

    function parseContinue() {
      const kw = expectKeyword("continue");
      const inSameFn =
        loopFnStack.length > 0 &&
        loopFnStack[loopFnStack.length - 1] === functionDepth;
      if (!inSameFn) {
        throw new ML.ParseError(
          "continue 只能出现在当前函数的 while 循环体内",
          kw.line,
          kw.col
        );
      }
      consumeSemicolon();
      return N.Continue({ line: kw.line, col: kw.col });
    }

    function parseExprStmt() {
      const start = peek();
      const expr = parseExpression();
      consumeSemicolon();
      return N.ExprStmt(expr, { line: start.line, col: start.col });
    }

    /* -------------------------------------------------------------- *
     * 表达式（Pratt）
     * -------------------------------------------------------------- */
    function parseExpression(minBp) {
      minBp = minBp || 0;
      let left = parsePrefix();

      for (;;) {
        const t = peek();
        if (t.kind !== TT.OP) break;

        // 赋值（右结合，低优先级）
        if (t.value === "=") {
          if (minBp > 0) break;
          if (left.type !== "Ident" && left.type !== "Index") {
            throw new ML.ParseError(
              "赋值左侧必须是变量或索引表达式",
              t.line,
              t.col
            );
          }
          next();
          const value = parseExpression(0);
          left = N.Assign(left, value, { line: t.line, col: t.col });
          continue;
        }

        const lbp = BINARY_PRECEDENCE[t.value];
        if (lbp === undefined || lbp < minBp) break;
        next();
        // 所有二元运算符均为左结合：右侧最小绑定力 = lbp + 1
        const right = parseExpression(lbp + 1);
        if (LOGICAL_OPS[t.value]) {
          left = N.Logical(t.value, left, right, {
            line: t.line,
            col: t.col,
          });
        } else {
          left = N.Binary(t.value, left, right, {
            line: t.line,
            col: t.col,
          });
        }
      }
      return left;
    }

    function parsePrefix() {
      const t = peek();
      if (t.kind === TT.OP && (t.value === "-" || t.value === "!")) {
        next();
        const arg = parsePrefix();
        return N.Unary(t.value, arg, { line: t.line, col: t.col });
      }
      return parsePostfix(parsePrimary());
    }

    function parsePostfix(node) {
      for (;;) {
        if (atOp("(")) {
          const open = next();
          const args = [];
          if (!atOp(")")) {
            do {
              args.push(parseExpression());
            } while (consumeComma());
          }
          expectOp(")");
          node = N.Call(node, args, { line: open.line, col: open.col });
          continue;
        }
        if (atOp("[")) {
          const open = next();
          const index = parseExpression();
          expectOp("]");
          node = N.Index(node, index, { line: open.line, col: open.col });
          continue;
        }
        break;
      }
      return node;
    }

    function parsePrimary() {
      const t = peek();

      if (t.kind === TT.NUMBER) {
        next();
        return N.NumberLit(t.value, { line: t.line, col: t.col });
      }
      if (t.kind === TT.STRING) {
        next();
        return N.StringLit(t.value, { line: t.line, col: t.col });
      }
      if (t.kind === TT.IDENT) {
        next();
        return N.Ident(t.value, { line: t.line, col: t.col });
      }
      if (t.kind === TT.KEYWORD) {
        if (t.value === "true" || t.value === "false") {
          next();
          return N.BoolLit(t.value === "true", { line: t.line, col: t.col });
        }
        if (t.value === "null") {
          next();
          return N.NullLit({ line: t.line, col: t.col });
        }
        if (t.value === "fn") {
          next();
          // 可选函数名（命名函数字面量，名字仅在函数体内可见）
          let name = null;
          let namePos = { line: t.line, col: t.col };
          if (peek().kind === TT.IDENT) {
            const nt = next();
            name = nt.value;
            namePos = { line: nt.line, col: nt.col };
          }
          functionDepth++;
          const { params, body } = parseParamsAndBody();
          functionDepth--;
          return N.FnExpr(name, params, body, namePos);
        }
      }
      if (atOp("(")) {
        next();
        const expr = parseExpression();
        expectOp(")");
        return parsePostfix(expr);
      }
      if (atOp("[")) {
        return parseArrayLit();
      }
      if (atOp("{")) {
        return parseHashLit();
      }

      throw new ML.ParseError(
        "期望表达式，但遇到 " + describe(t),
        t.line,
        t.col
      );
    }

    function parseArrayLit() {
      const open = expectOp("[");
      const elements = [];
      if (!atOp("]")) {
        do {
          elements.push(parseExpression());
        } while (consumeComma());
      }
      expectOp("]");
      return N.ArrayLit(elements, { line: open.line, col: open.col });
    }

    function parseHashLit() {
      const open = expectOp("{");
      const pairs = [];
      const seen = Object.create(null);
      if (!atOp("}")) {
        do {
          let key;
          const kt = peek();
          if (kt.kind === TT.STRING) {
            next();
            key = kt.value;
          } else if (kt.kind === TT.IDENT) {
            next();
            key = kt.value;
          } else {
            throw new ML.ParseError(
              "hash 键必须是字符串或标识符",
              kt.line,
              kt.col
            );
          }
          if (seen[key]) {
            throw new ML.ParseError(
              "hash 键重复: " + key,
              kt.line,
              kt.col
            );
          }
          seen[key] = true;
          expectOp(":");
          const value = parseExpression();
          pairs.push([key, value]);
        } while (consumeComma());
      }
      expectOp("}");
      return N.HashLit(pairs, { line: open.line, col: open.col });
    }

    return parseProgram();
  }

  function parse(source) {
    return parseTokens(ML.lex(source), source);
  }

  ML.parse = parse;
  ML.parseTokens = parseTokens;
})(typeof window !== "undefined" ? window : globalThis);
