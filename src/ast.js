/*
 * ast.js — Token 类型表、关键字表、AST 节点工厂。
 *
 * 设计说明：
 *  - Token 与 AST 节点都使用普通对象（{ kind, ... }）。
 *  - 不使用类继承体系，目的是让求值器在热循环中尽量少地分配临时对象，
 *    同时保持 switch(node.type) 的分发方式足够快。
 *  - 所有节点都带 pos（{ line, col }），便于把运行时错误定位回源码。
 */
(function (root) {
  "use strict";

  const ML = (root.MiniLang = root.MiniLang || {});

  /* ------------------------------------------------------------------ *
   * Token 类型
   * ------------------------------------------------------------------ */
  const TT = {
    NUMBER: "NUMBER",
    STRING: "STRING",
    IDENT: "IDENT",
    KEYWORD: "KEYWORD",
    OP: "OP",
    EOF: "EOF",
  };

  // MiniLang 保留字
  const KEYWORDS = Object.create(null);
  ["let", "if", "else", "while", "fn", "return", "break", "continue", "true", "false", "null"].forEach(
    (w) => (KEYWORDS[w] = true)
  );

  function token(kind, value, line, col) {
    return { kind: kind, value: value, line: line, col: col };
  }

  /* ------------------------------------------------------------------ *
   * AST 节点工厂
   * 每个节点都包含：
   *   type : 节点类型字符串
   *   pos  : { line, col }，指向节点在源码中的起始位置
   * ------------------------------------------------------------------ */
  const N = {
    Program(body, pos) {
      return { type: "Program", body: body, pos: pos };
    },
    NumberLit(value, pos) {
      return { type: "NumberLit", value: value, pos: pos };
    },
    StringLit(value, pos) {
      return { type: "StringLit", value: value, pos: pos };
    },
    BoolLit(value, pos) {
      return { type: "BoolLit", value: value, pos: pos };
    },
    NullLit(pos) {
      return { type: "NullLit", pos: pos };
    },
    ArrayLit(elements, pos) {
      return { type: "ArrayLit", elements: elements, pos: pos };
    },
    // pairs: [[keyString, valueNode], ...]
    HashLit(pairs, pos) {
      return { type: "HashLit", pairs: pairs, pos: pos };
    },
    Ident(name, pos) {
      return { type: "Ident", name: name, pos: pos };
    },
    Unary(op, arg, pos) {
      return { type: "Unary", op: op, arg: arg, pos: pos };
    },
    Binary(op, left, right, pos) {
      return { type: "Binary", op: op, left: left, right: right, pos: pos };
    },
    Logical(op, left, right, pos) {
      return { type: "Logical", op: op, left: left, right: right, pos: pos };
    },
    // target 只可能是 Ident / Index
    Assign(target, value, pos) {
      return { type: "Assign", target: target, value: value, pos: pos };
    },
    Let(name, value, pos) {
      return { type: "Let", name: name, value: value, pos: pos };
    },
    ExprStmt(expr, pos) {
      return { type: "ExprStmt", expr: expr, pos: pos };
    },
    Block(body, pos) {
      return { type: "Block", body: body, pos: pos };
    },
    If(test, consequent, alternate, pos) {
      return {
        type: "If",
        test: test,
        consequent: consequent,
        alternate: alternate,
        pos: pos,
      };
    },
    While(test, body, pos) {
      return { type: "While", test: test, body: body, pos: pos };
    },
    FnDecl(name, params, body, pos) {
      return {
        type: "FnDecl",
        name: name,
        params: params,
        body: body,
        pos: pos,
      };
    },
    FnExpr(name, params, body, pos) {
      return {
        type: "FnExpr",
        name: name,
        params: params,
        body: body,
        pos: pos,
      };
    },
    Return(value, pos) {
      return { type: "Return", value: value, pos: pos };
    },
    Break(pos) {
      return { type: "Break", pos: pos };
    },
    Continue(pos) {
      return { type: "Continue", pos: pos };
    },
    Call(callee, args, pos) {
      return { type: "Call", callee: callee, args: args, pos: pos };
    },
    Index(obj, index, pos) {
      return { type: "Index", obj: obj, index: index, pos: pos };
    },
  };

  ML.TT = TT;
  ML.KEYWORDS = KEYWORDS;
  ML.token = token;
  ML.N = N;
})(typeof window !== "undefined" ? window : globalThis);
