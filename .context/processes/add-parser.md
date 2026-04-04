# Process: Adding a New Language Parser

## When to Use

You need to add parsing support for a new programming language (e.g., Python, Java, Rust).

## Steps

### Step 1: Implement the Parser Interface

Load: `.context/domains/core.md`

1. Create `packages/core/src/parser/<language>.ts`
2. Implement the `ICodeParser` interface from `packages/core/src/parser/interface.ts`:

```ts
export interface ICodeParser {
  parseFile(filePath: string): Promise<ParseResult>;
  parseDirectory(dirPath: string, options?: ParseOptions): Promise<ParseResult>;
  resolveDispatch(callEdge: CallEdge, typeContext: TypeContext): Promise<DispatchResolution[]>;
  findImplementations(className: string, methodName: string): Promise<FunctionNode[]>;
}
```

3. Your parser must produce `ParseResult` containing:
   - `FunctionNode[]` — functions/methods with signature, parameters, return type, visibility, docs
   - `ClassNode[]` — classes with inheritance, methods, properties
   - `CallEdge[]` — function call relationships with line numbers
   - `BranchNode[]` — if/else, switch, ternary with condition text
   - `VariableNode[]` — variable declarations with type and scope
   - `InheritanceEdge[]` — class hierarchy relationships

### Step 2: Add Content Hashing

Implement content hashing for incremental parsing — only re-parse files whose content hash changed. Follow the pattern in `typescript.ts`.

### Step 3: Update Configuration

1. Add the new language to the `languages` array in the Zod config schema (`packages/core/src/config/loader.ts`)
2. Add parser-specific config section if needed (like `parser.typescript.tsconfig` or `parser.cpp.compileCommands`)

### Step 4: Write Tests

1. Create `packages/core/src/parser/<language>.test.ts`
2. Use in-memory source (not real files) following the pattern in `typescript.test.ts`
3. Test: function extraction, class extraction, call edge detection, branch detection, inheritance

### Step 5: Wire Up

1. Re-export from `packages/core/src/index.ts`
2. Update CLI `index-cmd.ts` to instantiate the new parser based on `project.languages` config
3. Update `.codegraph.yaml.example` with the new language option

### Step 6: Document

1. Create feature doc: `docs/features/NN-<language>-parser-support.md`
2. Update `.context/domains/core.md` with the new parser entry
