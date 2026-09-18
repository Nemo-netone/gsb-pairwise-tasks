/*
 * parser.js —— 语法分析器（手写递归下降 + Pratt 表达式）
 *
 * 文法概览：
 *   program     := statement*
 *   statement   := let | fn | if | while | return | break | continue | block | exprStmt
 *   expression  := Pratt 解析（赋值为右结合的最低优先级表达式）
 *
 * 优先级（从低到高）：
 *   =  (右结合)
 *   ||
 *   &&
 *   == !=
 *   < <= > >=
 *   + -
 *   * / %
 *   一元 - !
 *   后缀调用/索引
 */
(function (global) {
  "use strict";

  var ML = global.ML || (global.ML = {});
  var A = ML.ast;
  var ParseError = ML.object.ParseError;

  // 二进制优先级表（数字越大优先级越高）
  var BINARY_PRECEDENCE = {
    OR: 1,
    AND: 2,
    EQ: 3, NEQ: 3,
    LT: 4, LTE: 4, GT: 4, GTE: 4,
    PLUS: 5, MINUS: 5,
    STAR: 6, SLASH: 6, PERCENT: 6
  };

  function Parser(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  Parser.prototype.peek = function (offset) {
    var idx = this.index + (offset || 0);
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1];
  };
  Parser.prototype.current = function () {
    return this.tokens[this.index];
  };
  Parser.prototype.advance = function () {
    var tok = this.tokens[this.index];
    if (tok.type !== "EOF") this.index++;
    return tok;
  };
  Parser.prototype.check = function (type) {
    return this.current().type === type;
  };
  Parser.prototype.match = function (type) {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  };
  Parser.prototype.expect = function (type, what) {
    if (this.current().type !== type) {
      var tok = this.current();
      var msg = "期望 " + (what || type) + '，但遇到 "' + tok.value + '"';
      throw new ParseError(msg, { line: tok.line, col: tok.col });
    }
    return this.advance();
  };

  Parser.prototype.parse = function () {
    var pos = this.current();
    var statements = [];
    while (!this.check("EOF")) {
      statements.push(this.parseStatement());
    }
    return A.program({ line: pos.line, col: pos.col }, statements);
  };

  /* ------------------------------ 语句 ------------------------------ */

  Parser.prototype.parseStatement = function () {
    switch (this.current().type) {
      case "LBRACE": return this.parseBlock();
      case "LET": return this.parseLet();
      case "FN": return this.parseFn();
      case "IF": return this.parseIf();
      case "WHILE": return this.parseWhile();
      case "RETURN": return this.parseReturn();
      case "BREAK": return this.parseBreak();
      case "CONTINUE": return this.parseContinue();
      default: return this.parseExprStatement();
    }
  };

  Parser.prototype.parseBlock = function () {
    var brace = this.expect("LBRACE", "{");
    var statements = [];
    while (!this.check("RBRACE") && !this.check("EOF")) {
      statements.push(this.parseStatement());
    }
    this.expect("RBRACE", "}");
    return A.block({ line: brace.line, col: brace.col }, statements);
  };

  Parser.prototype.parseLet = function () {
    var kw = this.expect("LET", "let");
    var nameTok = this.expect("IDENT", "变量名");
    this.expect("ASSIGN", "=");
    var init = this.parseExpression();
    this.expect("SEMICOLON", ";");
    return A.letStmt({ line: kw.line, col: kw.col }, nameTok.value, init);
  };

  Parser.prototype.parseFn = function () {
    var kw = this.expect("FN", "fn");
    var nameTok = this.expect("IDENT", "函数名");
    var params = this.parseParams();
    var body = this.parseBlock();
    return A.fnStmt({ line: kw.line, col: kw.col }, nameTok.value, params, body);
  };

  // 解析 "(a, b, c)" 形参列表，返回参数名数组
  Parser.prototype.parseParams = function () {
    this.expect("LPAREN", "(");
    var params = [];
    if (!this.check("RPAREN")) {
      do {
        var tok = this.expect("IDENT", "参数名");
        if (params.indexOf(tok.value) !== -1) {
          throw new ParseError('参数 "' + tok.value + '" 重复声明', { line: tok.line, col: tok.col });
        }
        params.push(tok.value);
      } while (this.match("COMMA"));
    }
    this.expect("RPAREN", ")");
    return params;
  };

  Parser.prototype.parseIf = function () {
    var kw = this.expect("IF", "if");
    this.expect("LPAREN", "(");
    var test = this.parseExpression();
    this.expect("RPAREN", ")");
    var consequent = this.parseStatement();
    var alternate = null;
    if (this.match("ELSE")) {
      alternate = this.parseStatement(); // 可为 if，自然形成 else if 链
    }
    return A.ifStmt({ line: kw.line, col: kw.col }, test, consequent, alternate);
  };

  Parser.prototype.parseWhile = function () {
    var kw = this.expect("WHILE", "while");
    this.expect("LPAREN", "(");
    var test = this.parseExpression();
    this.expect("RPAREN", ")");
    var body = this.parseStatement();
    return A.whileStmt({ line: kw.line, col: kw.col }, test, body);
  };

  Parser.prototype.parseReturn = function () {
    var kw = this.expect("RETURN", "return");
    var value = null;
    if (!this.check("SEMICOLON")) {
      value = this.parseExpression();
    }
    this.expect("SEMICOLON", ";");
    return A.returnStmt({ line: kw.line, col: kw.col }, value);
  };

  Parser.prototype.parseBreak = function () {
    var kw = this.expect("BREAK", "break");
    this.expect("SEMICOLON", ";");
    return A.breakStmt({ line: kw.line, col: kw.col });
  };

  Parser.prototype.parseContinue = function () {
    var kw = this.expect("CONTINUE", "continue");
    this.expect("SEMICOLON", ";");
    return A.continueStmt({ line: kw.line, col: kw.col });
  };

  Parser.prototype.parseExprStatement = function () {
    var start = this.current();
    var expr = this.parseExpression();
    this.expect("SEMICOLON", ";");
    return A.exprStmt({ line: start.line, col: start.col }, expr);
  };

  /* ---------------------------- 表达式 ------------------------------ */

  Parser.prototype.parseExpression = function () {
    return this.parseAssignment();
  };

  // 赋值是右结合的最低优先级表达式：a = b = 3
  Parser.prototype.parseAssignment = function () {
    var left = this.parseBinary(0);
    if (this.check("ASSIGN")) {
      var eq = this.advance();
      if (left.kind !== "Identifier" && left.kind !== "Index") {
        throw new ParseError("赋值目标必须是变量或索引表达式", { line: eq.line, col: eq.col });
      }
      var value = this.parseAssignment();
      return A.assign({ line: eq.line, col: eq.col }, left, value);
    }
    return left;
  };

  // Pratt 核心：minPrec 为当前允许的最低优先级
  Parser.prototype.parseBinary = function (minPrec) {
    var left = this.parseUnary();
    while (true) {
      var tok = this.current();
      var prec = BINARY_PRECEDENCE[tok.type];
      if (prec === undefined || prec < minPrec) break;
      this.advance();
      // 左结合：右侧以 prec + 1 为下限
      var right = this.parseBinary(prec + 1);
      if (tok.type === "AND" || tok.type === "OR") {
        left = A.logical({ line: tok.line, col: tok.col }, tok.value, left, right);
      } else {
        left = A.binary({ line: tok.line, col: tok.col }, tok.value, left, right);
      }
    }
    return left;
  };

  Parser.prototype.parseUnary = function () {
    var tok = this.current();
    if (tok.type === "MINUS" || tok.type === "BANG") {
      this.advance();
      var arg = this.parseUnary(); // 一元运算右结合，且优先级高于二元
      return A.unary({ line: tok.line, col: tok.col }, tok.value, arg);
    }
    return this.parsePostfix();
  };

  Parser.prototype.parsePostfix = function () {
    var node = this.parsePrimary();
    while (true) {
      var tok = this.current();
      if (tok.type === "LPAREN") {
        this.advance();
        var args = [];
        if (!this.check("RPAREN")) {
          do {
            args.push(this.parseExpression());
          } while (this.match("COMMA"));
        }
        var close = this.expect("RPAREN", ")");
        node = A.call({ line: tok.line, col: tok.col }, node, args);
        node.closePos = { line: close.line, col: close.col };
      } else if (tok.type === "LBRACKET") {
        this.advance();
        var indexExpr = this.parseExpression();
        var closeB = this.expect("RBRACKET", "]");
        node = A.index({ line: tok.line, col: tok.col }, node, indexExpr);
        node.closePos = { line: closeB.line, col: closeB.col };
      } else {
        break;
      }
    }
    return node;
  };

  Parser.prototype.parsePrimary = function () {
    var tok = this.current();
    switch (tok.type) {
      case "NUMBER":
        this.advance();
        return A.numberLit({ line: tok.line, col: tok.col }, tok.value);
      case "STRING":
        this.advance();
        return A.stringLit({ line: tok.line, col: tok.col }, tok.value);
      case "TRUE":
        this.advance();
        return A.boolLit({ line: tok.line, col: tok.col }, true);
      case "FALSE":
        this.advance();
        return A.boolLit({ line: tok.line, col: tok.col }, false);
      case "NULL":
        this.advance();
        return A.nullLit({ line: tok.line, col: tok.col });
      case "IDENT":
        this.advance();
        return A.identifier({ line: tok.line, col: tok.col }, tok.value);
      case "LPAREN": {
        this.advance();
        var expr = this.parseExpression();
        this.expect("RPAREN", ")");
        return expr;
      }
      case "LBRACKET":
        return this.parseArray();
      case "LBRACE":
        return this.parseHash();
      case "FN":
        return this.parseFnExpression();
      default:
        throw new ParseError('此处不应出现 "' + tok.value + '"', { line: tok.line, col: tok.col });
    }
  };

  Parser.prototype.parseArray = function () {
    var bracket = this.expect("LBRACKET", "[");
    var elements = [];
    if (!this.check("RBRACKET")) {
      do {
        elements.push(this.parseExpression());
      } while (this.match("COMMA"));
    }
    this.expect("RBRACKET", "]");
    return A.arrayLit({ line: bracket.line, col: bracket.col }, elements);
  };

  Parser.prototype.parseHash = function () {
    var brace = this.expect("LBRACE", "{");
    var pairs = [];
    if (!this.check("RBRACE")) {
      do {
        var keyTok = this.expect("STRING", "字符串键");
        this.expect("COLON", ":");
        var valueExpr = this.parseExpression();
        pairs.push({ key: keyTok.value, value: valueExpr });
      } while (this.match("COMMA"));
    }
    this.expect("RBRACE", "}");
    return A.hashLit({ line: brace.line, col: brace.col }, pairs);
  };

  // fn(a, b) { ... } 匿名函数表达式
  Parser.prototype.parseFnExpression = function () {
    var kw = this.expect("FN", "fn");
    var params = this.parseParams();
    var body = this.parseBlock();
    return A.fnExpr({ line: kw.line, col: kw.col }, params, body);
  };

  function parse(tokens) {
    return new Parser(tokens).parse();
  }

  ML.parser = { parse: parse, Parser: Parser, BINARY_PRECEDENCE: BINARY_PRECEDENCE };
})(typeof window !== "undefined" ? window : globalThis);