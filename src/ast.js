/*
 * ast.js —— AST 节点定义
 *
 * 每个节点为普通对象：{ kind, pos, ...字段 }
 * pos 为该节点起始 token 的 { line, col }，供运行时错误定位。
 * 工厂函数只做字段挂载，不产生多余结构，减少求值期对象开销。
 */
(function (global) {
  "use strict";

  var ML = global.ML || (global.ML = {});

  function n(kind, pos, fields) {
    var node = { kind: kind, pos: pos };
    if (fields) {
      for (var key in fields) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) {
          node[key] = fields[key];
        }
      }
    }
    return node;
  }

  // 程序根节点：statements 为语句数组
  function program(pos, statements) {
    return n("Program", pos, { statements: statements });
  }

  /* ---------------- 语句 ---------------- */

  function block(pos, statements) {
    return n("Block", pos, { statements: statements });
  }
  function letStmt(pos, name, init) {
    return n("Let", pos, { name: name, init: init });
  }
  function ifStmt(pos, test, consequent, alternate) {
    return n("If", pos, { test: test, consequent: consequent, alternate: alternate });
  }
  function whileStmt(pos, test, body) {
    return n("While", pos, { test: test, body: body });
  }
  function fnStmt(pos, name, params, body) {
    return n("Fn", pos, { name: name, params: params, body: body });
  }
  function returnStmt(pos, value) {
    return n("Return", pos, { value: value }); // value 为 null 表示无返回值
  }
  function breakStmt(pos) {
    return n("Break", pos, {});
  }
  function continueStmt(pos) {
    return n("Continue", pos, {});
  }
  function exprStmt(pos, expr) {
    return n("ExprStmt", pos, { expr: expr });
  }

  /* ---------------- 表达式 ---------------- */

  function numberLit(pos, value) {
    return n("Number", pos, { value: value });
  }
  function stringLit(pos, value) {
    return n("String", pos, { value: value });
  }
  function boolLit(pos, value) {
    return n("Bool", pos, { value: value });
  }
  function nullLit(pos) {
    return n("Null", pos, {});
  }
  function identifier(pos, name) {
    return n("Identifier", pos, { name: name });
  }
  function arrayLit(pos, elements) {
    return n("Array", pos, { elements: elements });
  }
  function hashLit(pos, pairs) {
    // pairs: [{ key: string, value: exprNode }]
    return n("Hash", pos, { pairs: pairs });
  }
  function fnExpr(pos, params, body) {
    return n("FnExpr", pos, { params: params, body: body });
  }
  function unary(pos, op, arg) {
    return n("Unary", pos, { op: op, arg: arg });
  }
  function binary(pos, op, left, right) {
    return n("Binary", pos, { op: op, left: left, right: right });
  }
  function logical(pos, op, left, right) {
    return n("Logical", pos, { op: op, left: left, right: right });
  }
  function assign(pos, target, value) {
    // target 为 Identifier / Index
    return n("Assign", pos, { target: target, value: value });
  }
  function index(pos, obj, indexExpr) {
    return n("Index", pos, { obj: obj, index: indexExpr });
  }
  function call(pos, callee, args) {
    return n("Call", pos, { callee: callee, args: args });
  }

  ML.ast = {
    program: program,
    block: block,
    letStmt: letStmt,
    ifStmt: ifStmt,
    whileStmt: whileStmt,
    fnStmt: fnStmt,
    returnStmt: returnStmt,
    breakStmt: breakStmt,
    continueStmt: continueStmt,
    exprStmt: exprStmt,
    numberLit: numberLit,
    stringLit: stringLit,
    boolLit: boolLit,
    nullLit: nullLit,
    identifier: identifier,
    arrayLit: arrayLit,
    hashLit: hashLit,
    fnExpr: fnExpr,
    unary: unary,
    binary: binary,
    logical: logical,
    assign: assign,
    index: index,
    call: call
  };
})(typeof window !== "undefined" ? window : globalThis);