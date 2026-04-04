/**
 * esbuild config for CodeGraph Navigator VS Code extension.
 *
 * Bundles the extension + @codegraph/core and all transitive dependencies
 * into a single dist/extension.js file so the VSIX is self-contained.
 *
 * External: only 'vscode' (provided by VS Code runtime at load time).
 */
import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const buildOptions = {
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outdir: './dist',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  // Tree-shake unused code
  treeShaking: true,
  // Silence warnings about require() of dynamic modules in dependencies
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('esbuild: watching for changes...');
} else {
  await esbuild.build(buildOptions);
}
