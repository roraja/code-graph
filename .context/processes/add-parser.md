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
  readonly languages: string[];
  parseFile(filePath: string): Promise<ParseResult>;
  parseDirectory(rootDir: string, options?: { exclude?: string[]; include?: string[] }): Promise<ParseResult[]>;
  resolveDispatch(callSite: CallSite, context: DispatchContext): Promise<DispatchResolution[]>;
  findImplementations(method: FunctionNode): Promise<FunctionNode[]>;
}
```

3. Your parser must produce `ParseResult` containing:
   - `FunctionNode[]` — functions/methods with id, name, qualifiedName, signature, parameters (`ParameterInfo[]`), return type, visibility, source code, docs
   - `ClassNode[]` — classes with inheritance, methods, properties (`PropertyInfo[]`)
   - `CallEdge[]` — function call relationships with line numbers, virtual dispatch flag
   - `BranchNode[]` — if/else, switch, ternary with condition text and line ranges
   - `VariableNode[]` — variable declarations with type, scope (`local`/`parameter`/`member`/`global`/`property`), and owner
   - `InheritanceEdge[]` — class hierarchy relationships (`extends`/`implements`)
   - `contentHash: string` — for incremental parsing
   - `parseTimeMs: number` — performance tracking

### Step 2: Add Content Hashing

Implement content hashing for incremental parsing — only re-parse files whose content hash changed. Follow the pattern in `typescript.ts`.

### Step 3: Update Configuration

1. Add the new language to the `languages` array in the `project` section of the Zod config schema (`packages/core/src/config/loader.ts`)
2. Add a parser-specific config section with its own Zod schema if needed (like `TsParserConfigSchema` for TypeScript or `CppParserConfigSchema` for C++), then add it to the `parser` section of `CodeGraphConfigSchema`

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
