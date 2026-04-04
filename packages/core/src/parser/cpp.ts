/**
 * CppParser — Regex-based C++ source parser implementing ICodeParser.
 *
 * Extracts functions, classes, calls, branches, variables, and inheritance
 * from C++ source files. Designed for Chromium-style C++ code.
 *
 * @module parser/cpp
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { glob } from 'glob';
import type {
  ICodeParser,
  ParseResult,
  FunctionNode,
  ClassNode,
  CallEdge,
  BranchNode,
  VariableNode,
  InheritanceEdge,
  ParameterInfo,
  PropertyInfo,
  CallSite,
  DispatchContext,
  DispatchResolution,
} from './interface.js';

function makeId(filePath: string, line: number): string {
  return `${filePath}:${line}`;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Config for the C++ parser */
export interface CppParserConfig {
  compileCommands?: string;
  clangdPath?: string;
}

/**
 * Find the matching closing brace for an opening brace.
 * Returns the line index (0-based) of the closing brace, or -1 if not found.
 */
function findMatchingBrace(lines: string[], openBraceLine: number): number {
  let depth = 0;
  for (let i = openBraceLine; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

/** Parse C++ parameter list string into ParameterInfo[] */
function parseParameters(paramStr: string): ParameterInfo[] {
  if (!paramStr.trim()) return [];
  const params: ParameterInfo[] = [];
  let depth = 0;
  let current = '';

  for (const ch of paramStr) {
    if (ch === '<' || ch === '(') depth++;
    if (ch === '>' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      params.push(parseSingleParam(current.trim()));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    params.push(parseSingleParam(current.trim()));
  }
  return params;
}

function parseSingleParam(param: string): ParameterInfo {
  // Remove default values
  const eqIdx = param.indexOf('=');
  const defaultValue = eqIdx >= 0 ? param.slice(eqIdx + 1).trim() : undefined;
  const withoutDefault = eqIdx >= 0 ? param.slice(0, eqIdx).trim() : param;

  // Split into type and name — last token is name
  const tokens = withoutDefault.split(/\s+/);
  const name = tokens.length > 1 ? tokens[tokens.length - 1].replace(/[&*]+$/, '') : '';
  const type = tokens.length > 1 ? tokens.slice(0, -1).join(' ') : withoutDefault;

  return {
    name: name.replace(/^[&*]+/, ''),
    type: type.trim(),
    isOptional: defaultValue !== undefined,
    defaultValue,
  };
}

export class CppParser implements ICodeParser {
  readonly languages: string[] = ['cpp', 'cc', 'cxx', 'c', 'h', 'hpp'];
  private config: CppParserConfig;

  constructor(config?: CppParserConfig) {
    this.config = config ?? {};
  }

  async parseFile(filePath: string): Promise<ParseResult> {
    const start = performance.now();
    const content = await readFile(filePath, 'utf-8');
    const contentHash = hashContent(content);
    const lines = content.split('\n');

    const classes = this.extractClasses(lines, filePath);
    const functions = this.extractFunctions(lines, filePath, classes);
    const calls = this.extractCalls(lines, filePath, functions);
    const branches = this.extractBranches(lines, filePath, functions);
    const variables = this.extractVariables(lines, filePath, functions);
    const inheritances = this.extractInheritance(classes);

    return {
      filePath,
      language: 'cpp',
      functions,
      classes,
      calls,
      branches,
      variables,
      inheritances,
      contentHash,
      parseTimeMs: performance.now() - start,
    };
  }

  async parseDirectory(
    rootDir: string,
    options?: { exclude?: string[]; include?: string[] },
  ): Promise<ParseResult[]> {
    const includePatterns = options?.include ?? ['**/*.cc', '**/*.cpp', '**/*.cxx', '**/*.h', '**/*.hpp'];
    const excludePatterns = options?.exclude ?? ['**/test/**', '**/tests/**', '**/testing/**', '**/*_test.cc', '**/*_unittest.cc'];

    const files: string[] = [];
    for (const pattern of includePatterns) {
      const matched = await glob(pattern, {
        cwd: rootDir,
        absolute: true,
        ignore: excludePatterns,
      });
      files.push(...matched);
    }

    const uniqueFiles = Array.from(new Set(files));
    const results: ParseResult[] = [];

    for (const file of uniqueFiles) {
      try {
        const result = await this.parseFile(file);
        results.push(result);
      } catch {
        // Skip files that fail to parse
      }
    }
    return results;
  }

  async resolveDispatch(
    _callSite: CallSite,
    _context: DispatchContext,
  ): Promise<DispatchResolution[]> {
    return [];
  }

  async findImplementations(
    _method: FunctionNode,
  ): Promise<FunctionNode[]> {
    return [];
  }

  // --- Extraction Methods ---

  private extractClasses(lines: string[], filePath: string): ClassNode[] {
    const classes: ClassNode[] = [];

    // Match: class ClassName [final] [: public Base, ...] {
    const classRegex = /^(?:class|struct)\s+([\w]+)(?:\s+final)?(?:\s*:\s*(.+?))?\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      // Build multi-line match (class decl can span lines)
      let combined = lines[i].trim();
      // Skip forward declarations: class Foo;
      if (/^(?:class|struct)\s+\w+\s*;/.test(combined)) continue;
      // Skip template< lines for now
      if (combined.startsWith('template')) continue;

      // Try to accumulate lines if class decl spans multiple lines
      if (/^(?:class|struct)\s+\w+/.test(combined) && !combined.includes('{')) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          combined += ' ' + lines[j].trim();
          if (combined.includes('{')) break;
        }
      }

      const match = classRegex.exec(combined);
      if (!match) continue;

      const className = match[1];
      const startLine = i + 1;
      const endLine = findMatchingBrace(lines, i) + 1 || startLine;

      // Parse methods declared in the class body
      const methods: string[] = [];
      const properties: PropertyInfo[] = [];
      let currentVisibility = 'private'; // default for class

      for (let j = i + 1; j < (endLine - 1) && j < lines.length; j++) {
        const line = lines[j].trim();

        // Track visibility
        if (line.startsWith('public:')) { currentVisibility = 'public'; continue; }
        if (line.startsWith('protected:')) { currentVisibility = 'protected'; continue; }
        if (line.startsWith('private:')) { currentVisibility = 'private'; continue; }

        // Method declarations: ReturnType MethodName(params) [const] [override] [= 0] ;
        const methodMatch = /^(?:(?:virtual|static|explicit|inline|constexpr)\s+)*(.+?)\s+(\w+)\s*\(([^)]*)\)/.exec(line);
        if (methodMatch && !line.includes('DEFINE_') && !line.includes('DISALLOW_') && !line.includes('friend ')) {
          methods.push(`${className}::${methodMatch[2]}`);
        }

        // Member variable: Type name_;
        const memberMatch = /^(?:(?:mutable|static|const)\s+)*(.+?)\s+(\w+_)\s*(?:=|;)/.exec(line);
        if (memberMatch && !line.includes('(') && !line.startsWith('//') && !line.startsWith('using')) {
          properties.push({
            name: memberMatch[2],
            type: memberMatch[1],
            visibility: currentVisibility,
            isStatic: line.includes('static '),
            isReadonly: line.includes('const '),
          });
        }
      }

      // Get documentation (comment block before class)
      let documentation: string | undefined;
      if (i > 0 && lines[i - 1].trim().startsWith('//')) {
        const docLines: string[] = [];
        for (let j = i - 1; j >= 0 && lines[j].trim().startsWith('//'); j--) {
          docLines.unshift(lines[j].trim().replace(/^\/\/\s?/, ''));
        }
        documentation = docLines.join('\n');
      }

      const isAbstract = combined.includes('= 0') ||
        lines.slice(i, endLine).some(l => l.includes('= 0;'));

      classes.push({
        id: makeId(filePath, startLine),
        name: className,
        qualifiedName: className,
        filePath,
        startLine,
        endLine,
        isAbstract,
        isInterface: false,
        language: 'cpp',
        methods,
        properties,
        documentation,
      });
    }
    return classes;
  }

  private extractFunctions(lines: string[], filePath: string, classes: ClassNode[]): FunctionNode[] {
    const functions: FunctionNode[] = [];
    const isHeader = filePath.endsWith('.h') || filePath.endsWith('.hpp');

    // Build class name set for method detection
    const classNames = new Set(classes.map(c => c.name));

    // Match function definitions:
    // ReturnType [ClassName::]FunctionName(params) [const] [override] {
    // Also handles constructors/destructors: ClassName::ClassName(params) {
    // Also handles: ClassName::~ClassName() {

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments, preprocessor, includes, using, namespace lines
      if (trimmed.startsWith('//') || trimmed.startsWith('#') ||
          trimmed.startsWith('using ') || trimmed.startsWith('namespace ') ||
          trimmed === '' || trimmed === '}') continue;

      // Skip lines inside class declarations in headers (already extracted as methods)
      if (isHeader) {
        let inClass = false;
        for (const cls of classes) {
          if (i + 1 >= cls.startLine && i + 1 <= cls.endLine) {
            inClass = true;
            break;
          }
        }
        if (inClass) continue;
      }

      // Build multi-line for function signatures that span lines
      let combined = trimmed;
      if (/\w+\s*\(/.test(combined) && !combined.includes('{') && !combined.includes(';')) {
        for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
          combined += ' ' + lines[j].trim();
          if (combined.includes('{') || combined.includes(';')) break;
        }
      }

      // Function definition pattern (must have opening brace)
      // Handles: Type Class::Method(params) const { ... }
      // Handles: Type Function(params) { ... }
      // Handles: Class::Class(params) : init_list { ... }
      // Handles: Class::~Class() { ... }
      const funcPattern = /^(?:(?:virtual|static|inline|constexpr|explicit)\s+)*(?:(.+?)\s+)?((?:\w+::)*~?\w+)\s*\(([^)]*)\)\s*(?:const\s*)?(?:override\s*)?(?:final\s*)?(?:noexcept\s*)?(?::\s*[^{]+?)?\{/;

      if (!combined.includes('{')) continue;
      const match = funcPattern.exec(combined);
      if (!match) continue;

      // Skip macros, defines
      if (match[2].startsWith('DEFINE_') || match[2] === 'if' || match[2] === 'for' ||
          match[2] === 'while' || match[2] === 'switch' || match[2] === 'catch' ||
          match[2].startsWith('TEST') || match[2] === 'namespace') continue;

      const returnType = match[1]?.trim() ?? 'void';
      const fullName = match[2];
      const paramStr = match[3];

      // Parse qualified name
      const parts = fullName.split('::');
      const simpleName = parts[parts.length - 1];
      const className = parts.length > 1 ? parts.slice(0, -1).join('::') : undefined;

      // Find the function body end
      const openBraceLine = i + combined.slice(0, combined.indexOf('{')).split('\n').length - 1;
      let actualOpenLine = i;
      for (let j = i; j < Math.min(i + 8, lines.length); j++) {
        if (lines[j].includes('{')) { actualOpenLine = j; break; }
      }
      const endLineIdx = findMatchingBrace(lines, actualOpenLine);
      if (endLineIdx < 0) continue;

      const startLine = i + 1;
      const endLine = endLineIdx + 1;

      // Extract source code
      const sourceCode = lines.slice(i, Math.min(endLineIdx + 1, i + 50)).join('\n');

      // Determine visibility
      let visibility = 'public'; // default for C++
      if (className) {
        const cls = classes.find(c => c.name === className);
        if (cls) {
          // Check the method declaration in the class
          let vis = 'private';
          for (let j = cls.startLine - 1; j < cls.endLine - 1 && j < lines.length; j++) {
            const cline = lines[j].trim();
            if (cline.startsWith('public:')) vis = 'public';
            if (cline.startsWith('protected:')) vis = 'protected';
            if (cline.startsWith('private:')) vis = 'private';
            if (cline.includes(simpleName)) { visibility = vis; break; }
          }
        }
      }

      const isDestructor = simpleName.startsWith('~');
      const isConstructor = className !== undefined && simpleName === className;
      const isVirtual = combined.includes('virtual ') || combined.includes('override');
      const isAbstract = combined.includes('= 0');

      const parameters = parseParameters(paramStr);
      const qualifiedName = className ? `${className}::${simpleName}` : simpleName;

      functions.push({
        id: makeId(filePath, startLine),
        name: simpleName,
        qualifiedName,
        filePath,
        startLine,
        endLine,
        signature: `${returnType} ${qualifiedName}(${paramStr.trim()})`,
        isAbstract,
        isOverride: combined.includes('override'),
        visibility,
        language: 'cpp',
        sourceCode,
        parameters,
        returnType: isConstructor || isDestructor ? 'void' : returnType,
        isExported: combined.includes('CONTENT_EXPORT') || combined.includes('BLINK_EXPORT'),
        isAsync: false,
        documentation: this.getDocComment(lines, i),
      });
    }

    return functions;
  }

  private extractCalls(lines: string[], filePath: string, functions: FunctionNode[]): CallEdge[] {
    const calls: CallEdge[] = [];
    const seenCalls = new Set<string>();

    for (const fn of functions) {
      const fnLines = lines.slice(fn.startLine - 1, fn.endLine);

      for (let lineOffset = 0; lineOffset < fnLines.length; lineOffset++) {
        const line = fnLines[lineOffset];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

        const lineNum = fn.startLine + lineOffset;

        // Pattern 1: object->Method(args)  or  object.Method(args)
        const arrowCallRegex = /(\w+)(?:->|\.)(~?\w+)\s*\(/g;
        let m;
        while ((m = arrowCallRegex.exec(line)) !== null) {
          const receiver = m[1];
          const method = m[2];
          if (this.isBoringCall(method)) continue;
          const key = `${fn.id}->${receiver}.${method}:${lineNum}`;
          if (seenCalls.has(key)) continue;
          seenCalls.add(key);
          calls.push({
            callerId: fn.id,
            calleeId: method,
            calleeName: method,
            filePath,
            line: lineNum,
            column: m.index,
            isVirtualDispatch: receiver.endsWith('_') || line.includes('->'),
            callExpression: `${receiver}->${method}`,
          });
        }

        // Pattern 2: ClassName::StaticMethod(args)
        const staticCallRegex = /(\w+)::(~?\w+)\s*\(/g;
        while ((m = staticCallRegex.exec(line)) !== null) {
          const cls = m[1];
          const method = m[2];
          if (this.isBoringCall(method) || this.isBoringCall(cls)) continue;
          // Skip common non-calls
          if (['std', 'base', 'BUILDFLAG', 'DCHECK', 'CHECK', 'LOG'].includes(cls)) continue;
          const qualifiedCall = `${cls}::${method}`;
          const key = `${fn.id}->${qualifiedCall}:${lineNum}`;
          if (seenCalls.has(key)) continue;
          seenCalls.add(key);
          calls.push({
            callerId: fn.id,
            calleeId: qualifiedCall,
            calleeName: qualifiedCall,
            filePath,
            line: lineNum,
            column: m.index,
            isVirtualDispatch: false,
            callExpression: qualifiedCall,
          });
        }

        // Pattern 3: Free function calls FunctionName(args)
        // Must start at word boundary, not preceded by type keywords
        const freeCallRegex = /(?<![:\w.>])(\b[A-Z]\w+)\s*\(/g;
        while ((m = freeCallRegex.exec(line)) !== null) {
          const funcName = m[1];
          if (this.isBoringCall(funcName)) continue;
          if (['if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'decltype',
               'static_cast', 'dynamic_cast', 'reinterpret_cast', 'const_cast',
               'DCHECK', 'CHECK', 'LOG', 'DLOG', 'DVLOG', 'TRACE_EVENT',
               'NOTREACHED', 'BUILDFLAG', 'DEFINE', 'TEST'].includes(funcName)) continue;
          const key = `${fn.id}->${funcName}:${lineNum}`;
          if (seenCalls.has(key)) continue;
          seenCalls.add(key);
          calls.push({
            callerId: fn.id,
            calleeId: funcName,
            calleeName: funcName,
            filePath,
            line: lineNum,
            column: m.index,
            isVirtualDispatch: false,
            callExpression: funcName,
          });
        }
      }
    }
    return calls;
  }

  private extractBranches(lines: string[], filePath: string, functions: FunctionNode[]): BranchNode[] {
    const branches: BranchNode[] = [];

    for (const fn of functions) {
      const fnLines = lines.slice(fn.startLine - 1, fn.endLine);

      for (let lineOffset = 0; lineOffset < fnLines.length; lineOffset++) {
        const trimmed = fnLines[lineOffset].trim();
        const lineNum = fn.startLine + lineOffset;

        // if / else if
        const ifMatch = /^(?:}\s*)?(?:else\s+)?if\s*\((.+?)\)\s*\{?/.exec(trimmed);
        if (ifMatch) {
          const type = trimmed.startsWith('}') || trimmed.startsWith('else') ? 'else_if' : 'if';
          const condition = ifMatch[1];
          const thenStart = lineNum;
          const globalLineIdx = fn.startLine - 1 + lineOffset;
          let thenEnd = lineNum;
          if (lines[globalLineIdx]?.includes('{')) {
            const endIdx = findMatchingBrace(lines, globalLineIdx);
            if (endIdx >= 0) thenEnd = endIdx + 1;
          }

          // Look for else block
          let elseStart: number | undefined;
          let elseEnd: number | undefined;
          if (thenEnd > lineNum && thenEnd <= lines.length) {
            const afterThen = lines[thenEnd - 1]?.trim() ?? '';
            if (afterThen.includes('else') || (thenEnd < lines.length && lines[thenEnd]?.trim().startsWith('else'))) {
              const elseLine = afterThen.includes('else') ? thenEnd - 1 : thenEnd;
              elseStart = elseLine + 1;
              if (lines[elseLine]?.includes('{')) {
                const elseEndIdx = findMatchingBrace(lines, elseLine);
                if (elseEndIdx >= 0) elseEnd = elseEndIdx + 1;
              }
            }
          }

          branches.push({
            id: makeId(filePath, lineNum),
            type,
            condition,
            functionId: fn.id,
            filePath,
            line: lineNum,
            thenStartLine: thenStart,
            thenEndLine: thenEnd,
            elseStartLine: elseStart,
            elseEndLine: elseEnd,
          });
          continue;
        }

        // switch
        const switchMatch = /^switch\s*\((.+?)\)\s*\{?/.exec(trimmed);
        if (switchMatch) {
          branches.push({
            id: makeId(filePath, lineNum),
            type: 'switch_case',
            condition: switchMatch[1],
            functionId: fn.id,
            filePath,
            line: lineNum,
            thenStartLine: lineNum,
            thenEndLine: lineNum + 1,
          });
        }

        // Ternary
        if (trimmed.includes('?') && trimmed.includes(':') && !trimmed.startsWith('//') &&
            !trimmed.startsWith('case') && !trimmed.includes('::')) {
          const ternaryMatch = /(.+?)\s*\?\s*(.+?)\s*:\s*(.+)/.exec(trimmed);
          if (ternaryMatch) {
            branches.push({
              id: makeId(filePath, lineNum),
              type: 'ternary',
              condition: ternaryMatch[1].trim(),
              functionId: fn.id,
              filePath,
              line: lineNum,
              thenStartLine: lineNum,
              thenEndLine: lineNum,
            });
          }
        }
      }
    }
    return branches;
  }

  private extractVariables(lines: string[], filePath: string, functions: FunctionNode[]): VariableNode[] {
    const variables: VariableNode[] = [];

    for (const fn of functions) {
      // Extract local variable declarations from function body
      const fnLines = lines.slice(fn.startLine - 1, fn.endLine);
      for (let lineOffset = 1; lineOffset < fnLines.length - 1; lineOffset++) {
        const trimmed = fnLines[lineOffset].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed === '') continue;

        // Match: Type varName = value;  or  Type varName;
        const varMatch = /^(?:const\s+)?(?:auto|(?:\w+(?:::\w+)*(?:<[^>]+>)?(?:\s*[*&])?)\s+)(\w+)\s*(?:=\s*(.+?))?\s*;/.exec(trimmed);
        if (varMatch && !trimmed.includes('(') && !['return', 'if', 'for', 'while', 'switch', 'case', 'break', 'continue'].includes(varMatch[1])) {
          const lineNum = fn.startLine + lineOffset;
          variables.push({
            id: makeId(filePath, lineNum),
            name: varMatch[1],
            type: trimmed.split(varMatch[1])[0].trim(),
            scope: 'local',
            filePath,
            line: lineNum,
            functionId: fn.id,
            initialValue: varMatch[2]?.trim(),
          });
        }
      }

      // Add parameters as variables
      for (const param of fn.parameters) {
        if (param.name) {
          variables.push({
            id: `${fn.id}:param:${param.name}`,
            name: param.name,
            type: param.type,
            scope: 'parameter',
            filePath,
            line: fn.startLine,
            functionId: fn.id,
          });
        }
      }
    }
    return variables;
  }

  private extractInheritance(classes: ClassNode[]): InheritanceEdge[] {
    const edges: InheritanceEdge[] = [];
    // Re-parse class declarations to find base classes
    // This is done by re-reading the class, but we already have the raw lines
    // For now, we parse the qualifiedName from the original extraction
    return edges;
  }

  private isBoringCall(name: string): boolean {
    const boring = [
      'DCHECK', 'DCHECK_EQ', 'DCHECK_NE', 'DCHECK_LT', 'DCHECK_LE', 'DCHECK_GT', 'DCHECK_GE',
      'CHECK', 'CHECK_EQ', 'CHECK_NE', 'CHECK_LT', 'CHECK_LE', 'CHECK_GT', 'CHECK_GE',
      'LOG', 'DLOG', 'DVLOG', 'VLOG', 'PLOG',
      'TRACE_EVENT', 'TRACE_EVENT0', 'TRACE_EVENT1', 'TRACE_EVENT2',
      'NOTREACHED', 'NOTIMPLEMENTED',
      'std', 'base',
      'BUILDFLAG', 'DEFINE', 'TEST', 'TEST_F', 'TEST_P',
      'sizeof', 'decltype', 'static_cast', 'dynamic_cast', 'reinterpret_cast', 'const_cast',
      'Move', 'move', 'forward', 'make_unique', 'make_shared',
    ];
    return boring.includes(name);
  }

  private getDocComment(lines: string[], lineIndex: number): string | undefined {
    if (lineIndex === 0) return undefined;
    const docLines: string[] = [];
    for (let j = lineIndex - 1; j >= 0; j--) {
      const trimmed = lines[j].trim();
      if (trimmed.startsWith('//')) {
        docLines.unshift(trimmed.replace(/^\/\/\s?/, ''));
      } else if (trimmed === '' && docLines.length > 0) {
        break;
      } else {
        break;
      }
    }
    return docLines.length > 0 ? docLines.join('\n') : undefined;
  }
}
