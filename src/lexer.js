/*
 * lexer.js —— 词法分析器
 *
 * 将源代码转换为 token 流。每个 token：
 *   { type, value, line, col }
 * 出错时抛出 ML.object.ParseError，pos 带行:列。
 *
 * 支持：
 *   - 数字（含小数）、双引号字符串（\n \t \\ \" 转义）
 *   - 标识符与关键字
 *   - 运算符 + - * / % == != < <= > >= && || ! = ( ) { } [ ] , : ;
 *   - // 单行注释
 */
(function (global) {
  "use strict";

  var ML = global.ML || (global.ML = {});
  var ParseError = ML.object.ParseError;

  var KEYWORDS = {
    "let": "LET",
    "if": "IF",
    "else": "ELSE",
    "while": "WHILE",
    "fn": "FN",
    "return": "RETURN",
    "break": "BREAK",
    "continue": "CONTINUE",
    "true": "TRUE",
    "false": "FALSE",
    "null": "NULL"
  };

  function isDigit(ch) {
    return ch >= "0" && ch <= "9";
  }
  function isAlpha(ch) {
    return (ch >= "a" && ch <= "z") ||
           (ch >= "A" && ch <= "Z") ||
           ch === "_" || ch === "$";
  }
  function isAlphaNum(ch) {
    return isAlpha(ch) || isDigit(ch);
  }

  function Lexer(source) {
    this.source = source;
    this.chars = source; // 字符串本身即可按索引取字符
    this.len = source.length;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
  }

  Lexer.prototype.peek = function (offset) {
    var idx = this.pos + (offset || 0);
    return idx < this.len ? this.chars.charAt(idx) : "";
  };

  Lexer.prototype.advance = function () {
    var ch = this.chars.charAt(this.pos++);
    if (ch === "\n") {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  };

  Lexer.prototype.error = function (message) {
    return new ParseError(message, { line: this.line, col: this.col });
  };

  Lexer.prototype.skipWhitespaceAndComments = function () {
    while (this.pos < this.len) {
      var ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
      } else if (ch === "/" && this.peek(1) === "/") {
        while (this.pos < this.len && this.peek() !== "\n") this.advance();
      } else {
        break;
      }
    }
  };

  Lexer.prototype.readNumber = function (line, col) {
    var start = this.pos;
    var seenDot = false;
    while (this.pos < this.len) {
      var ch = this.peek();
      if (isDigit(ch)) {
        this.advance();
      } else if (ch === "." && !seenDot && isDigit(this.peek(1))) {
        seenDot = true;
        this.advance();
      } else {
        break;
      }
    }
    var text = this.source.slice(start, this.pos);
    var value = parseFloat(text);
    if (!isFinite(value)) {
      throw new ParseError("数字超出可表示范围", { line: line, col: col });
    }
    this.tokens.push({ type: "NUMBER", value: value, line: line, col: col });
  };

  Lexer.prototype.readString = function (line, col) {
    this.advance(); // 吃掉开头引号
    var out = "";
    while (this.pos < this.len) {
      var ch = this.advance();
      if (ch === '"') {
        this.tokens.push({ type: "STRING", value: out, line: line, col: col });
        return;
      }
      if (ch === "\n") {
        throw new ParseError("字符串未闭合（不能跨行）", { line: line, col: col });
      }
      if (ch === "\\") {
        var esc = this.advance();
        switch (esc) {
          case "n": out += "\n"; break;
          case "t": out += "\t"; break;
          case "r": out += "\r"; break;
          case "\\": out += "\\"; break;
          case '"': out += '"'; break;
          case "":
            throw new ParseError("字符串未闭合（转义符后到达文件末尾）", { line: line, col: col });
          default:
            throw new ParseError('非法转义字符 "\\' + esc + '"', { line: this.line, col: this.col });
        }
      } else {
        out += ch;
      }
    }
    throw new ParseError("字符串未闭合（到达文件末尾）", { line: line, col: col });
  };

  Lexer.prototype.readIdentifier = function (line, col) {
    var start = this.pos;
    while (this.pos < this.len && isAlphaNum(this.peek())) this.advance();
    var text = this.source.slice(start, this.pos);
    var type = KEYWORDS[text] || "IDENT";
    this.tokens.push({ type: type, value: text, line: line, col: col });
  };

  // 双字符运算符优先
  Lexer.prototype.readOperator = function (line, col) {
    var ch = this.peek();
    var two = ch + this.peek(1);
    var twoChar = {
      "==": "EQ", "!=": "NEQ", "<=": "LTE", ">=": "GTE",
      "&&": "AND", "||": "OR"
    };
    if (twoChar[two]) {
      this.advance();
      this.advance();
      this.tokens.push({ type: twoChar[two], value: two, line: line, col: col });
      return;
    }
    var single = {
      "+": "PLUS", "-": "MINUS", "*": "STAR", "/": "SLASH", "%": "PERCENT",
      "<": "LT", ">": "GT", "!": "BANG", "=": "ASSIGN",
      "(": "LPAREN", ")": "RPAREN", "{": "LBRACE", "}": "RBRACE",
      "[": "LBRACKET", "]": "RBRACKET",
      ",": "COMMA", ":": "COLON", ";": "SEMICOLON"
    };
    if (single[ch]) {
      this.advance();
      this.tokens.push({ type: single[ch], value: ch, line: line, col: col });
      return;
    }
    throw this.error('无法识别的字符 "' + ch + '"');
  };

  Lexer.prototype.tokenize = function () {
    while (true) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.len) break;
      var line = this.line;
      var col = this.col;
      var ch = this.peek();
      if (isDigit(ch)) {
        this.readNumber(line, col);
      } else if (ch === '"') {
        this.readString(line, col);
      } else if (isAlpha(ch)) {
        this.readIdentifier(line, col);
      } else {
        this.readOperator(line, col);
      }
    }
    this.tokens.push({ type: "EOF", value: "", line: this.line, col: this.col });
    return this.tokens;
  };

  function tokenize(source) {
    return new Lexer(source).tokenize();
  }

  ML.lexer = { tokenize: tokenize, Lexer: Lexer };
})(typeof window !== "undefined" ? window : globalThis);