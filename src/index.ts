// Copyright (c) 2021 Saddam M. All rights reserved.
// @ts-nocheck
import {
  ParseOptions,
  Module,
  Identifier,
  parseSync,
  ArrayExpression,
  BlockStatement,
  CallExpression,
  ObjectExpression,
  VariableDeclarator,
  ExpressionStatement,
  FunctionDeclaration,
  BlockStatement,
  ReturnStatement,
  transformSync as transformMorphedAST,
} from "@swc/core";
import SWCVisitor from "@swc/core/Visitor.js";
import {
  interop_mapSpanToLocObject,
  interop_morphIdentifier,
  interop_traverseAST,
  interop_reverseAST,
  interop_reverseLocObjectToSpan,
} from "./helpers.js";
import * as t from "@babel/types";

export interface InteropConfig {
  swc?: ParseOptions;
  babel?: any;
}

const { default: Visitor } = SWCVisitor;

class InteropVisitor extends Visitor {
  visitIdentifier(ident: Identifier): Identifier {
    interop_mapSpanToLocObject(ident);
    interop_morphIdentifier(ident);
    return ident;
  }

  visitBlockStatement(block: BlockStatement): BlockStatement {
    interop_mapSpanToLocObject(block);
    block.body = block.stmts;
    // delete stmt.stmts;
    // This line costed me 3+ hours of debugging.
    // return super.visitBlockStatement(block);
    return super.visitExpression(block);
  }

  visitCallExpression(expr: CallExpression): CallExpression {
    interop_mapSpanToLocObject(expr);
    expr.callee = super.visitExpression(expr.callee);
    expr.arguments = expr.arguments.map((arg: any) =>
      super.visitExpression(arg.expression)
    );

    return expr;
  }

  visitVariableDeclarator(vardecl: VariableDeclarator): VariableDeclarator {
    interop_mapSpanToLocObject(vardecl);
    interop_mapSpanToLocObject(vardecl.init, true);
    if (vardecl.init.type !== "ArrayExpression")
      vardecl.init = super.visitExpression(vardecl.init);
    return super.visitVariableDeclarator(vardecl);
  }

  visitArrayExpression(expr: ArrayExpression): ArrayExpression {
    interop_mapSpanToLocObject(expr);
    expr.elements = expr.elements.map((el: any) =>
      super.visitExpression(el.expression)
    );

    return expr;
  }

  visitObjectExpression(expr: ObjectExpression): ObjectExpression {
    expr.properties = expr.properties.map((kvpair: any) => {
      // Capture on second visit.
      if (kvpair && kvpair.type === "ObjectProperty") {
        interop_mapSpanToLocObject(kvpair.key);
        interop_mapSpanToLocObject(kvpair.value);
        kvpair.method = kvpair.computed = kvpair.shorthand = false;
        interop_morphIdentifier(kvpair.key)
        try {
          super.visitExpression(kvpair.value)
        } catch (error) { }
      }

      // ES2015^ shorthand object field identifiers.
      // @TODO: Plugins can't intercept this change.
      else if (kvpair && kvpair.type === "Identifier") {
        interop_morphIdentifier(kvpair);
        interop_mapSpanToLocObject(kvpair);
        kvpair.method = kvpair.computed = false;
        kvpair.shorthand = true;
        return { type: "ObjectProperty", key: kvpair, value: kvpair };
      }

      kvpair.type = "ObjectProperty";
      return { ...kvpair, type: "ObjectProperty" };
    });

    return expr;
  }

  visitFunctionDeclaration(fndecl: FunctionDeclaration): FunctionDeclaration {
    interop_mapSpanToLocObject(fndecl);
    fndecl.id = this.visitIdentifier(fndecl.identifier);
    delete fndecl.identifier;
    fndecl.params = fndecl.params.map((p: any) => {
      this.visitIdentifier(p.pat);
      return p.pat;
    });
    // this.visitBlockStatement(fndecl.body);
    return fndecl;
  }

  // visitReturnStatement(retstmt: ReturnStatement): ReturnStatement {
  //   interop_mapSpanToLocObject(retstmt);
  //   retstmt.argument = super.visitExpression(retstmt.argument);
  //   return super.visitExpression(retstmt);
  // }

  constructor() {
    super();

    const identicalImplNodes = [
      "AssignmentExpression",
      "IfStatement",
      "BinaryExpression",
      "NumericLiteral",
      "MemberExpression",
      "ExpressionStatement",
      "CallExpression",
      "ReturnStatement"
    ];

    for (const tt of identicalImplNodes) {
      this[`visit${tt}`] = (node: any): any => {
        interop_mapSpanToLocObject(node);
        // Refer to https://github.com/swc-project/plugin-strip-console/issues/2
        return super[`visit${tt}`](node);
      };
    }
  }

  // visitExpressionStatement(expr: ExpressionStatement) {
  //   interop_mapSpanToLocObject(expr);
  //   return super.visitExpressionStatement(expr);
  // }
}

export function transformSync(
  src: string,
  options: InteropConfig = {}
): string {
  // Phase 1: Parsing.
  let ast = parseSync(src, options.swc);
  new InteropVisitor().visitProgram(ast);
  ast.type = "Program";
  interop_mapSpanToLocObject(ast);
  console.log(JSON.stringify(ast.body[0], null, 2));
  return;
  ast = t.file(ast);

  // Phase 2: AST Traversal.
  if (options.babel && options.babel.plugins) {
    interop_traverseAST(ast, options.babel.plugins);
  }

  // Phase 3: Code generation.
  interop_reverseAST(ast.program);
  interop_reverseLocObjectToSpan(ast.program);
  console.log(JSON.stringify(ast.program));
  ast.program.type = "Module";
  const { code, map } = transformMorphedAST(ast.program, options.swc);
  // console.log(code);
  return { code, map };
}
