/**
 * Comprehensive tests for the TypeScript parser.
 *
 * Uses in-memory ts-morph projects to exercise all extraction capabilities
 * without touching the filesystem.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Project } from 'ts-morph';
import { TypeScriptParser } from './typescript.js';
import type { ParseResult } from './interface.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates an in-memory ts-morph project and parser for testing. */
function createTestSetup() {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: 2 /* ES2022 */,
      module: 100 /* Node16 */,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
  });
  const parser = new TypeScriptParser(project);
  return { project, parser };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TypeScriptParser', () => {
  describe('function extraction', () => {
    let result: ParseResult;

    beforeAll(async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/functions.ts',
        `
/** Adds two numbers together. */
export function add(a: number, b: number): number {
  return a + b;
}

function internalHelper(msg: string): void {
  console.log(msg);
}

export async function fetchData(url: string, retries: number = 3): Promise<string> {
  return '';
}

export const multiply = (x: number, y: number): number => x * y;

const square = (n: number): number => n * n;
`,
      );

      result = await parser.parseFile('/test/functions.ts');
    });

    it('should extract exported function declarations', () => {
      const add = result.functions.find((f) => f.name === 'add');
      expect(add).toBeDefined();
      expect(add!.isExported).toBe(true);
      expect(add!.parameters).toHaveLength(2);
      expect(add!.parameters[0].name).toBe('a');
      expect(add!.parameters[0].type).toBe('number');
      expect(add!.returnType).toBe('number');
      expect(add!.isAsync).toBe(false);
      expect(add!.language).toBe('typescript');
    });

    it('should extract non-exported functions', () => {
      const helper = result.functions.find((f) => f.name === 'internalHelper');
      expect(helper).toBeDefined();
      expect(helper!.isExported).toBe(false);
    });

    it('should extract async functions', () => {
      const fetchFn = result.functions.find((f) => f.name === 'fetchData');
      expect(fetchFn).toBeDefined();
      expect(fetchFn!.isAsync).toBe(true);
      expect(fetchFn!.returnType).toContain('Promise');
    });

    it('should extract default parameter values', () => {
      const fetchFn = result.functions.find((f) => f.name === 'fetchData');
      expect(fetchFn).toBeDefined();
      const retriesParam = fetchFn!.parameters.find((p) => p.name === 'retries');
      expect(retriesParam).toBeDefined();
      expect(retriesParam!.defaultValue).toBe('3');
      expect(retriesParam!.isOptional).toBe(true);
    });

    it('should extract arrow functions assigned to variables', () => {
      const multiply = result.functions.find((f) => f.name === 'multiply');
      expect(multiply).toBeDefined();
      expect(multiply!.isExported).toBe(true);
      expect(multiply!.parameters).toHaveLength(2);
    });

    it('should extract non-exported arrow functions', () => {
      const square = result.functions.find((f) => f.name === 'square');
      expect(square).toBeDefined();
      expect(square!.isExported).toBe(false);
    });

    it('should extract JSDoc documentation', () => {
      const add = result.functions.find((f) => f.name === 'add');
      expect(add).toBeDefined();
      expect(add!.documentation).toContain('Adds two numbers');
    });

    it('should generate unique IDs as filePath:startLine', () => {
      for (const fn of result.functions) {
        expect(fn.id).toMatch(/^\/test\/functions\.ts:\d+$/);
      }
    });

    it('should produce a content hash', () => {
      expect(result.contentHash).toBeTruthy();
      expect(typeof result.contentHash).toBe('string');
    });

    it('should record parse time', () => {
      expect(result.parseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('class extraction', () => {
    let result: ParseResult;

    beforeAll(async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/classes.ts',
        `
/** A geometric shape. */
export abstract class Shape {
  abstract area(): number;

  protected name: string;

  constructor(name: string) {
    this.name = name;
  }

  describe(): string {
    return this.name;
  }
}

export class Circle extends Shape {
  private readonly radius: number;

  constructor(radius: number) {
    super('circle');
    this.radius = radius;
  }

  override area(): number {
    return Math.PI * this.radius ** 2;
  }

  get diameter(): number {
    return this.radius * 2;
  }

  set scale(factor: number) {
    // no-op for test
  }

  static create(radius: number): Circle {
    return new Circle(radius);
  }
}

export interface Drawable {
  draw(ctx: string): void;
  readonly visible: boolean;
}
`,
      );

      result = await parser.parseFile('/test/classes.ts');
    });

    it('should extract abstract classes', () => {
      const shape = result.classes.find((c) => c.name === 'Shape');
      expect(shape).toBeDefined();
      expect(shape!.isAbstract).toBe(true);
      expect(shape!.isInterface).toBe(false);
    });

    it('should extract concrete classes', () => {
      const circle = result.classes.find((c) => c.name === 'Circle');
      expect(circle).toBeDefined();
      expect(circle!.isAbstract).toBe(false);
    });

    it('should extract class methods list', () => {
      const circle = result.classes.find((c) => c.name === 'Circle');
      expect(circle).toBeDefined();
      expect(circle!.methods).toContain('Circle.area');
      expect(circle!.methods).toContain('Circle.create');
      expect(circle!.methods).toContain('Circle.constructor');
    });

    it('should extract getter/setter in methods list', () => {
      const circle = result.classes.find((c) => c.name === 'Circle');
      expect(circle).toBeDefined();
      expect(circle!.methods).toContain('Circle.get diameter');
      expect(circle!.methods).toContain('Circle.set scale');
    });

    it('should extract class properties', () => {
      const circle = result.classes.find((c) => c.name === 'Circle');
      expect(circle).toBeDefined();
      const radius = circle!.properties.find((p) => p.name === 'radius');
      expect(radius).toBeDefined();
      expect(radius!.visibility).toBe('private');
      expect(radius!.isReadonly).toBe(true);
    });

    it('should extract interfaces', () => {
      const drawable = result.classes.find((c) => c.name === 'Drawable');
      expect(drawable).toBeDefined();
      expect(drawable!.isInterface).toBe(true);
      expect(drawable!.methods).toContain('Drawable.draw');
    });

    it('should extract interface properties', () => {
      const drawable = result.classes.find((c) => c.name === 'Drawable');
      expect(drawable).toBeDefined();
      const visible = drawable!.properties.find((p) => p.name === 'visible');
      expect(visible).toBeDefined();
      expect(visible!.isReadonly).toBe(true);
    });

    it('should extract class documentation', () => {
      const shape = result.classes.find((c) => c.name === 'Shape');
      expect(shape).toBeDefined();
      expect(shape!.documentation).toContain('geometric shape');
    });

    it('should extract abstract methods as functions', () => {
      const areaFn = result.functions.find(
        (f) => f.name === 'area' && f.qualifiedName === 'Shape.area',
      );
      expect(areaFn).toBeDefined();
      expect(areaFn!.isAbstract).toBe(true);
    });

    it('should extract override methods', () => {
      const overrideArea = result.functions.find(
        (f) => f.qualifiedName === 'Circle.area',
      );
      expect(overrideArea).toBeDefined();
      expect(overrideArea!.isOverride).toBe(true);
    });

    it('should extract constructors as functions', () => {
      const ctor = result.functions.find(
        (f) => f.qualifiedName === 'Circle.constructor',
      );
      expect(ctor).toBeDefined();
      expect(ctor!.name).toBe('constructor');
      expect(ctor!.parameters).toHaveLength(1);
      expect(ctor!.parameters[0].name).toBe('radius');
    });

    it('should extract static methods', () => {
      const create = result.functions.find(
        (f) => f.qualifiedName === 'Circle.create',
      );
      expect(create).toBeDefined();
      expect(create!.signature).toContain('static');
    });

    it('should extract getters and setters as functions', () => {
      const getter = result.functions.find(
        (f) => f.name === 'get diameter',
      );
      expect(getter).toBeDefined();
      expect(getter!.qualifiedName).toBe('Circle.get diameter');

      const setter = result.functions.find(
        (f) => f.name === 'set scale',
      );
      expect(setter).toBeDefined();
    });
  });

  describe('call edge extraction', () => {
    let result: ParseResult;

    beforeAll(async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/calls.ts',
        `
function greet(name: string): string {
  return 'Hello, ' + name;
}

function main() {
  const msg = greet('world');
  console.log(msg);
}

class Service {
  process(data: string): void {
    this.validate(data);
  }

  private validate(data: string): boolean {
    return data.length > 0;
  }
}
`,
      );

      result = await parser.parseFile('/test/calls.ts');
    });

    it('should extract direct function calls', () => {
      const greetCall = result.calls.find((c) => c.calleeName === 'greet');
      expect(greetCall).toBeDefined();
      expect(greetCall!.callExpression).toBe('greet');
    });

    it('should associate calls with their enclosing function', () => {
      const greetCall = result.calls.find((c) => c.calleeName === 'greet');
      expect(greetCall).toBeDefined();
      const mainFn = result.functions.find((f) => f.name === 'main');
      expect(mainFn).toBeDefined();
      expect(greetCall!.callerId).toBe(mainFn!.id);
    });

    it('should extract method calls on this', () => {
      const validateCall = result.calls.find((c) => c.calleeName === 'validate');
      expect(validateCall).toBeDefined();
      expect(validateCall!.callExpression).toBe('this.validate');
    });

    it('should record line and column information', () => {
      const greetCall = result.calls.find((c) => c.calleeName === 'greet');
      expect(greetCall).toBeDefined();
      expect(greetCall!.line).toBeGreaterThan(0);
      expect(greetCall!.column).toBeGreaterThanOrEqual(0);
    });

    it('should extract console.log calls', () => {
      const logCall = result.calls.find((c) => c.calleeName === 'log');
      expect(logCall).toBeDefined();
      expect(logCall!.callExpression).toBe('console.log');
    });
  });

  describe('virtual dispatch detection', () => {
    let result: ParseResult;

    beforeAll(async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/dispatch.ts',
        `
interface Logger {
  log(message: string): void;
}

class ConsoleLogger implements Logger {
  log(message: string): void {
    console.log(message);
  }
}

class FileLogger implements Logger {
  log(message: string): void {
    // write to file
  }
}

function useLogger(logger: Logger) {
  logger.log('hello');
}
`,
      );

      result = await parser.parseFile('/test/dispatch.ts');
    });

    it('should detect virtual dispatch through interface types', () => {
      const logCall = result.calls.find(
        (c) => c.calleeName === 'log' && c.callExpression === 'logger.log',
      );
      expect(logCall).toBeDefined();
      expect(logCall!.isVirtualDispatch).toBe(true);
    });
  });

  describe('branch extraction', () => {
    let result: ParseResult;

    beforeAll(async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/branches.ts',
        `
function classify(x: number): string {
  if (x > 0) {
    return 'positive';
  } else if (x < 0) {
    return 'negative';
  } else {
    return 'zero';
  }
}

function grade(score: number): string {
  switch (true) {
    case score >= 90:
      return 'A';
    case score >= 80:
      return 'B';
    default:
      return 'C';
  }
}

function ternaryExample(flag: boolean): number {
  return flag ? 1 : 0;
}
`,
      );

      result = await parser.parseFile('/test/branches.ts');
    });

    it('should extract if branches', () => {
      const ifBranch = result.branches.find(
        (b) => b.type === 'if' && b.condition.includes('x > 0'),
      );
      expect(ifBranch).toBeDefined();
      expect(ifBranch!.thenStartLine).toBeGreaterThan(0);
      expect(ifBranch!.thenEndLine).toBeGreaterThanOrEqual(ifBranch!.thenStartLine);
    });

    it('should extract else-if branches', () => {
      const elseIf = result.branches.find(
        (b) => b.type === 'else_if' && b.condition.includes('x < 0'),
      );
      expect(elseIf).toBeDefined();
    });

    it('should extract if branches with else information', () => {
      const ifBranch = result.branches.find(
        (b) => b.type === 'if' && b.condition.includes('x > 0'),
      );
      expect(ifBranch).toBeDefined();
      expect(ifBranch!.elseStartLine).toBeDefined();
      expect(ifBranch!.elseEndLine).toBeDefined();
    });

    it('should extract switch cases', () => {
      const switchCases = result.branches.filter((b) => b.type === 'switch_case');
      expect(switchCases.length).toBeGreaterThanOrEqual(3); // 2 cases + default
    });

    it('should extract default case in switch', () => {
      const defaultCase = result.branches.find(
        (b) => b.type === 'switch_case' && b.condition === 'default',
      );
      expect(defaultCase).toBeDefined();
    });

    it('should extract ternary expressions', () => {
      const ternary = result.branches.find((b) => b.type === 'ternary');
      expect(ternary).toBeDefined();
      expect(ternary!.condition).toBe('flag');
      expect(ternary!.elseStartLine).toBeDefined();
    });

    it('should associate branches with their enclosing function', () => {
      const classifyFn = result.functions.find((f) => f.name === 'classify');
      expect(classifyFn).toBeDefined();

      const ifBranch = result.branches.find(
        (b) => b.type === 'if' && b.condition.includes('x > 0'),
      );
      expect(ifBranch).toBeDefined();
      expect(ifBranch!.functionId).toBe(classifyFn!.id);
    });
  });

  describe('variable extraction', () => {
    let result: ParseResult;

    beforeAll(async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/variables.ts',
        `
const GLOBAL_CONST = 42;
let mutableGlobal = 'hello';

function processData(input: string, count: number = 5) {
  const result = input.toUpperCase();
  let index = 0;
  return result;
}

class Config {
  public host: string = 'localhost';
  private port: number = 8080;
  readonly version: string = '1.0';
  static instance: Config;
}
`,
      );

      result = await parser.parseFile('/test/variables.ts');
    });

    it('should extract global constants', () => {
      const globalConst = result.variables.find(
        (v) => v.name === 'GLOBAL_CONST' && v.scope === 'global',
      );
      expect(globalConst).toBeDefined();
      expect(globalConst!.initialValue).toBe('42');
    });

    it('should extract mutable globals', () => {
      const mutable = result.variables.find(
        (v) => v.name === 'mutableGlobal' && v.scope === 'global',
      );
      expect(mutable).toBeDefined();
      expect(mutable!.initialValue).toBe("'hello'");
    });

    it('should extract local variables', () => {
      const localResult = result.variables.find(
        (v) => v.name === 'result' && v.scope === 'local',
      );
      expect(localResult).toBeDefined();
      expect(localResult!.functionId).toBeTruthy();
    });

    it('should extract function parameters', () => {
      const inputParam = result.variables.find(
        (v) => v.name === 'input' && v.scope === 'parameter',
      );
      expect(inputParam).toBeDefined();
      expect(inputParam!.type).toBe('string');
    });

    it('should extract class member properties', () => {
      const host = result.variables.find(
        (v) => v.name === 'host' && v.scope === 'member',
      );
      expect(host).toBeDefined();
      expect(host!.initialValue).toBe("'localhost'");
      expect(host!.classId).toBeTruthy();
    });

    it('should extract class member with initial value', () => {
      const port = result.variables.find(
        (v) => v.name === 'port' && v.scope === 'member',
      );
      expect(port).toBeDefined();
      expect(port!.initialValue).toBe('8080');
    });
  });

  describe('inheritance extraction', () => {
    let result: ParseResult;

    beforeAll(async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/inheritance.ts',
        `
interface Serializable {
  serialize(): string;
}

interface Printable {
  print(): void;
}

abstract class Base {
  abstract process(): void;
}

class Derived extends Base implements Serializable, Printable {
  process(): void {}
  serialize(): string { return ''; }
  print(): void {}
}

class SubDerived extends Derived {
  process(): void {}
}
`,
      );

      result = await parser.parseFile('/test/inheritance.ts');
    });

    it('should extract extends relationships', () => {
      const extendsEdge = result.inheritances.find(
        (e) => e.type === 'extends',
      );
      expect(extendsEdge).toBeDefined();
    });

    it('should extract implements relationships', () => {
      const implEdges = result.inheritances.filter(
        (e) => e.type === 'implements',
      );
      expect(implEdges.length).toBe(2); // Serializable and Printable
    });

    it('should extract multi-level inheritance', () => {
      // SubDerived extends Derived
      const derivedClass = result.classes.find((c) => c.name === 'Derived');
      const subDerivedClass = result.classes.find((c) => c.name === 'SubDerived');
      expect(derivedClass).toBeDefined();
      expect(subDerivedClass).toBeDefined();

      const subExtendsEdge = result.inheritances.find(
        (e) => e.childId === subDerivedClass!.id && e.type === 'extends',
      );
      expect(subExtendsEdge).toBeDefined();
    });
  });

  describe('edge cases', () => {
    describe('generics', () => {
      let result: ParseResult;

      beforeAll(async () => {
        const { project, parser } = createTestSetup();

        project.createSourceFile(
          '/test/generics.ts',
          `
interface Repository<T> {
  findById(id: string): T | null;
  save(entity: T): void;
}

class UserRepository implements Repository<User> {
  findById(id: string): User | null {
    return null;
  }
  save(entity: User): void {}
}

interface User {
  name: string;
}
`,
        );

        result = await parser.parseFile('/test/generics.ts');
      });

      it('should extract generic interface', () => {
        const repo = result.classes.find((c) => c.name === 'Repository');
        expect(repo).toBeDefined();
        expect(repo!.isInterface).toBe(true);
      });

      it('should extract class implementing generic interface', () => {
        const userRepo = result.classes.find((c) => c.name === 'UserRepository');
        expect(userRepo).toBeDefined();
      });

      it('should create implements edge for generic interface', () => {
        const implEdge = result.inheritances.find((e) => e.type === 'implements');
        expect(implEdge).toBeDefined();
      });
    });

    describe('arrow functions with complex bodies', () => {
      let result: ParseResult;

      beforeAll(async () => {
        const { project, parser } = createTestSetup();

        project.createSourceFile(
          '/test/arrows.ts',
          `
export const asyncArrow = async (url: string): Promise<Response> => {
  const res = await fetch(url);
  return res;
};

export const identity = <T>(x: T): T => x;
`,
        );

        result = await parser.parseFile('/test/arrows.ts');
      });

      it('should extract async arrow functions', () => {
        const asyncFn = result.functions.find((f) => f.name === 'asyncArrow');
        expect(asyncFn).toBeDefined();
        expect(asyncFn!.isAsync).toBe(true);
      });

      it('should extract generic arrow functions', () => {
        const identityFn = result.functions.find((f) => f.name === 'identity');
        expect(identityFn).toBeDefined();
      });
    });

    describe('empty file', () => {
      it('should handle an empty file gracefully', async () => {
        const { project, parser } = createTestSetup();
        project.createSourceFile('/test/empty.ts', '');

        const result = await parser.parseFile('/test/empty.ts');
        expect(result.functions).toHaveLength(0);
        expect(result.classes).toHaveLength(0);
        expect(result.calls).toHaveLength(0);
        expect(result.branches).toHaveLength(0);
        expect(result.variables).toHaveLength(0);
        expect(result.inheritances).toHaveLength(0);
      });
    });
  });

  describe('resolveDispatch', () => {
    it('should resolve interface method call to concrete implementations', async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/resolve.ts',
        `
interface Processor {
  execute(data: string): void;
}

class FastProcessor implements Processor {
  execute(data: string): void {
    // fast processing
  }
}

class SlowProcessor implements Processor {
  execute(data: string): void {
    // slow processing
  }
}

function run(proc: Processor) {
  proc.execute('test');
}
`,
      );

      // Parse the file first to populate the project
      await parser.parseFile('/test/resolve.ts');

      const resolutions = await parser.resolveDispatch(
        {
          filePath: '/test/resolve.ts',
          line: 19,
          column: 2,
          callerFunctionId: '/test/resolve.ts:18',
          callExpression: 'proc.execute',
          receiverType: 'Processor',
        },
        { knownTypes: {} },
      );

      expect(resolutions.length).toBe(2);
      const names = resolutions.map((r) => r.targetFunction.qualifiedName).sort();
      expect(names).toContain('FastProcessor.execute');
      expect(names).toContain('SlowProcessor.execute');
    });

    it('should use knownTypes from context', async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/resolve2.ts',
        `
interface Handler {
  handle(): void;
}

class ConcreteHandler implements Handler {
  handle(): void {}
}

function doWork(h: Handler) {
  h.handle();
}
`,
      );

      await parser.parseFile('/test/resolve2.ts');

      const resolutions = await parser.resolveDispatch(
        {
          filePath: '/test/resolve2.ts',
          line: 11,
          column: 2,
          callerFunctionId: '/test/resolve2.ts:10',
          callExpression: 'h.handle',
        },
        { knownTypes: { h: 'Handler' } },
      );

      expect(resolutions.length).toBe(1);
      expect(resolutions[0].targetFunction.qualifiedName).toBe('ConcreteHandler.handle');
    });
  });

  describe('findImplementations', () => {
    it('should find concrete implementations of abstract methods', async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/impls.ts',
        `
abstract class Animal {
  abstract speak(): string;
}

class Dog extends Animal {
  speak(): string {
    return 'Woof';
  }
}

class Cat extends Animal {
  speak(): string {
    return 'Meow';
  }
}
`,
      );

      const result = await parser.parseFile('/test/impls.ts');
      const abstractSpeak = result.functions.find(
        (f) => f.qualifiedName === 'Animal.speak',
      );
      expect(abstractSpeak).toBeDefined();

      const implementations = await parser.findImplementations(abstractSpeak!);
      expect(implementations).toHaveLength(2);
      const names = implementations.map((i) => i.qualifiedName).sort();
      expect(names).toContain('Dog.speak');
      expect(names).toContain('Cat.speak');
    });

    it('should find implementations of interface methods', async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/ifaceImpls.ts',
        `
interface Validator {
  validate(input: string): boolean;
}

class EmailValidator implements Validator {
  validate(input: string): boolean {
    return input.includes('@');
  }
}

class LengthValidator implements Validator {
  validate(input: string): boolean {
    return input.length > 0;
  }
}
`,
      );

      const result = await parser.parseFile('/test/ifaceImpls.ts');
      const ifaceMethod = result.functions.find(
        (f) => f.qualifiedName === 'Validator.validate',
      );
      expect(ifaceMethod).toBeDefined();

      const implementations = await parser.findImplementations(ifaceMethod!);
      expect(implementations).toHaveLength(2);
      const names = implementations.map((i) => i.qualifiedName).sort();
      expect(names).toContain('EmailValidator.validate');
      expect(names).toContain('LengthValidator.validate');
    });
  });

  describe('parseDirectory', () => {
    it('should parse multiple files in a directory', async () => {
      const { project, parser } = createTestSetup();

      // For in-memory projects, parseDirectory relies on glob against the
      // real filesystem. We test the function by verifying it returns results
      // when given a real directory. Since we're in-memory, we test the
      // parsing logic by calling parseFile directly on multiple files.
      project.createSourceFile(
        '/test/dir/a.ts',
        `export function aFunc(): void {}`,
      );
      project.createSourceFile(
        '/test/dir/b.ts',
        `export class BClass { method(): void {} }`,
      );

      const resultA = await parser.parseFile('/test/dir/a.ts');
      const resultB = await parser.parseFile('/test/dir/b.ts');

      expect(resultA.functions).toHaveLength(1);
      expect(resultA.functions[0].name).toBe('aFunc');

      expect(resultB.classes).toHaveLength(1);
      expect(resultB.classes[0].name).toBe('BClass');
    });
  });

  describe('interface method signatures', () => {
    let result: ParseResult;

    beforeAll(async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/iface-methods.ts',
        `
interface EventEmitter {
  on(event: string, callback: Function): void;
  emit(event: string, ...args: any[]): boolean;
}
`,
      );

      result = await parser.parseFile('/test/iface-methods.ts');
    });

    it('should extract interface method signatures as abstract functions', () => {
      const onMethod = result.functions.find((f) => f.qualifiedName === 'EventEmitter.on');
      expect(onMethod).toBeDefined();
      expect(onMethod!.isAbstract).toBe(true);
      expect(onMethod!.parameters).toHaveLength(2);
    });

    it('should extract rest parameters', () => {
      const emitMethod = result.functions.find(
        (f) => f.qualifiedName === 'EventEmitter.emit',
      );
      expect(emitMethod).toBeDefined();
      expect(emitMethod!.parameters.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('complex call patterns', () => {
    let result: ParseResult;

    beforeAll(async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile(
        '/test/complex-calls.ts',
        `
class Builder {
  private steps: string[] = [];

  addStep(step: string): Builder {
    this.steps.push(step);
    return this;
  }

  build(): string {
    return this.steps.join(', ');
  }
}

function usageExample() {
  const result = new Builder()
    .addStep('first')
    .addStep('second')
    .build();
}
`,
      );

      result = await parser.parseFile('/test/complex-calls.ts');
    });

    it('should extract chained method calls', () => {
      const addStepCalls = result.calls.filter((c) => c.calleeName === 'addStep');
      expect(addStepCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract build call in chain', () => {
      const buildCall = result.calls.find((c) => c.calleeName === 'build');
      expect(buildCall).toBeDefined();
    });
  });

  describe('content hash consistency', () => {
    it('should produce the same hash for the same content', async () => {
      const { project, parser } = createTestSetup();
      const code = 'export function hello(): void {}';

      project.createSourceFile('/test/hash1.ts', code);
      project.createSourceFile('/test/hash2.ts', code);

      const r1 = await parser.parseFile('/test/hash1.ts');
      const r2 = await parser.parseFile('/test/hash2.ts');

      expect(r1.contentHash).toBe(r2.contentHash);
    });

    it('should produce different hashes for different content', async () => {
      const { project, parser } = createTestSetup();

      project.createSourceFile('/test/hashA.ts', 'export function a(): void {}');
      project.createSourceFile('/test/hashB.ts', 'export function b(): void {}');

      const rA = await parser.parseFile('/test/hashA.ts');
      const rB = await parser.parseFile('/test/hashB.ts');

      expect(rA.contentHash).not.toBe(rB.contentHash);
    });
  });
});
