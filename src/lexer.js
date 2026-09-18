/*
 * lexer.js — 词法分析器
 *
 * 职责：把源码字符串切分为 token 流。
 * 规则：
 *   - 标识符：[A-Za-z_][A-Za-z0-9_]*，命中保留字则标记为 KEYWORD
 *   - 数字：支持整数与小数（含 .5 / 5. 形式），禁止 1..2
 *   - 字符串：双引号，支持 \n \t \\ \"
 *   - 注释：// 直到行尾
 *   - 运算符：+ - * / % == != <= >= < > = ( ) { } [ ] , ; ! && ||
 *   - 行列均为 1-based；列按字符计数
 */
(function (root) {
  "use strict";

  const ML = root.MiniLang;
  const TT = ML.TT;
  const KEYWORDS = ML.KEYWORDS;

  const isDigit = (c) => c >= "0" && c <= "9";
  const isAlpha = (c) =>
    (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  const isAlnum = (c) => isAlpha(c) || isDigit(c);

  // 多字符运算符优先匹配
  const TWO_CHAR_OPS = ["==", "!=", "<=", ">=", "&&", "||"];
  const ONE_CHAR_OPS = new Set(
    "+-*/%<>!=(){}[],;:".split("")
  );

  function tokenize(source) {
    const tokens = [];
    const src = source;
    let i = 0;
    let line = 1;
    let col = 1;

    // 记录换行后的列回退
    function advance() {
      const c = src[i];
      i++;
      if (c === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      return c;
    }

    function peek(offset) {
      return src[i + (offset || 0)];
    }

    while (i < src.length) {
      const c = src[i];

      // 空白
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        advance();
        continue;
      }

      // 单行注释 //
      if (c === "/" && peek(1) === "/") {
        while (i < src.length && src[i] !== "\n") advance();
        continue;
      }

      const startLine = line;
      const startCol = col;

      // 数字
      if (isDigit(c) || (c === "." && isDigit(peek(1)))) {
        let numStr = "";
        let sawDot = false;
        while (i < src.length) {
          const ch = src[i];
          if (isDigit(ch)) {
            numStr += advance();
          } else if (ch === ".") {
            if (sawDot) {
              throw new ML.LexError(
                "数字中包含多个小数点: " + numStr + ".",
                line,
                col
              );
            }
            sawDot = true;
            numStr += advance();
          } else {
            break;
          }
        }
        // 数字后紧跟字母属于非法，例如 12abc
        if (i < src.length && isAlpha(src[i])) {
          throw new ML.LexError("无法识别的数字字面量", startLine, startCol);
        }
        tokens.push(
          ML.token(TT.NUMBER, parseFloat(numStr), startLine, startCol)
        );
        continue;
      }

      // 字符串
      if (c === '"') {
        advance(); // 吃掉开引号
        let value = "";
        let closed = false;
        while (i < src.length) {
          const ch = src[i];
          if (ch === "\n") {
            throw new ML.LexError(
              "字符串未闭合（遇到换行）",
              startLine,
              startCol
            );
          }
          if (ch === '"') {
            advance();
            closed = true;
            break;
          }
          if (ch === "\\") {
            advance(); // 吃掉反斜杠
            if (i >= src.length) break;
            const esc = src[i];
            if (esc === "n") value += "\n";
            else if (esc === "t") value += "\t";
            else if (esc === "\\") value += "\\";
            else if (esc === '"') value += '"';
            else if (esc === "r") value += "\r";
            else {
              throw new ML.LexError(
                "非法字符串转义: \\" + esc,
                line,
                col
              );
            }
            advance();
          } else {
            value += advance();
          }
        }
        if (!closed) {
          throw new ML.LexError("字符串未闭合", startLine, startCol);
        }
        tokens.push(ML.token(TT.STRING, value, startLine, startCol));
        continue;
      }

      // 标识符 / 关键字
      if (isAlpha(c)) {
        let name = "";
        while (i < src.length && isAlnum(src[i])) name += advance();
        if (KEYWORDS[name]) {
          tokens.push(ML.token(TT.KEYWORD, name, startLine, startCol));
        } else {
          tokens.push(ML.token(TT.IDENT, name, startLine, startCol));
        }
        continue;
      }

      // 运算符
      const two = src.substr(i, 2);
      if (TWO_CHAR_OPS.indexOf(two) !== -1) {
        advance();
        advance();
        tokens.push(ML.token(TT.OP, two, startLine, startCol));
        continue;
      }
      if (ONE_CHAR_OPS.has(c)) {
        advance();
        tokens.push(ML.token(TT.OP, c, startLine, startCol));
        continue;
      }

      throw new ML.LexError("无法识别的字符: " + c, startLine, startCol);
    }

    tokens.push(ML.token(TT.EOF, null, line, col));
    return tokens;
  }

  ML.lex = tokenize;
})(typeof window !== "undefined" ? window : globalThis);
