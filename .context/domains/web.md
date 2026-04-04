# Domain: Web UI (@codegraph/web)

## Scope

React + Vite single-page application with graph visualization. Located in `packages/web/`.

## Key Technologies

| Technology | Purpose |
|------------|---------|
| React 18 | UI framework |
| Vite 5 | Build tool + dev server |
| Cytoscape.js | Call graph visualization |
| Zustand | State management |
| Apollo Client | GraphQL client (connects to server) |
| React Router | Client-side routing |

## Structure

```
src/
├── components/         # React components
│   ├── ScenarioList    # Browse discovered scenarios
│   ├── ScenarioDetail  # View scenario with steps
│   ├── Walkthrough     # Step-by-step walkthrough UI
│   ├── CallGraph       # Cytoscape.js graph visualization
│   └── CorrectionChat  # Submit corrections in natural language
├── stores/             # Zustand state stores
└── main.tsx            # Vite entry point
```

## Patterns

- **Zustand stores**: State management over Redux — simpler API, no boilerplate
- **Apollo Client**: GraphQL queries/mutations to `@codegraph/server`
- **Cytoscape.js**: Declarative graph rendering for call paths and class hierarchies
- **Vite**: HMR dev server (`npm run dev`), production build (`npm run build`)
- **tsconfig**: Uses ESNext module (browser target), not Node16 like other packages

## Dev Commands

```bash
npm run dev       # Vite dev server with HMR
npm run build     # TypeScript check + Vite production build
npm run preview   # Preview production build locally
```
