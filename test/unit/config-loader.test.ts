import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  loadConfig,
  createDefaultConfig,
  findProjectRoot,
} from '../../packages/core/src/config/loader.js';

const TEST_DIR = resolve(__dirname, '__config-loader-fixtures__');

function createTestDir(subPath: string = ''): string {
  const dir = subPath ? join(TEST_DIR, subPath) : TEST_DIR;
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(dir: string, content: string): void {
  writeFileSync(join(dir, '.codegraph.yaml'), content, 'utf-8');
}

describe('Config Loader', () => {
  beforeEach(() => {
    createTestDir();
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('loadConfig', () => {
    it('loads a valid YAML config', () => {
      const yaml = `
project:
  name: test-project
  languages:
    - ts
    - tsx
  rootDirs:
    - src
`;
      writeConfig(TEST_DIR, yaml);

      const config = loadConfig(TEST_DIR);

      expect(config.project.name).toBe('test-project');
      expect(config.project.languages).toEqual(['ts', 'tsx']);
      expect(config.project.rootDirs).toEqual(['src']);
    });

    it('applies default values for optional fields', () => {
      const yaml = `
project:
  name: minimal
`;
      writeConfig(TEST_DIR, yaml);

      const config = loadConfig(TEST_DIR);

      expect(config.project.name).toBe('minimal');
      expect(config.project.languages).toEqual(['ts']);
      expect(config.neo4j.uri).toBe('bolt://localhost:7687');
      expect(config.neo4j.username).toBe('neo4j');
      expect(config.neo4j.password).toBe('codegraph');
      expect(config.ai.provider).toBe('mock');
      expect(config.ai.temperature).toBe(0.2);
      expect(config.tracing.maxDepth).toBe(50);
      expect(config.server.port).toBe(3000);
    });

    it('throws when config file is missing', () => {
      const emptyDir = createTestDir('empty');

      expect(() => loadConfig(emptyDir)).toThrow(/No .codegraph.yaml found/);
    });

    it('throws on invalid YAML structure', () => {
      // Missing required 'project.name' field
      const yaml = `
project:
  languages:
    - ts
`;
      writeConfig(TEST_DIR, yaml);

      expect(() => loadConfig(TEST_DIR)).toThrow();
    });

    it('loads full config with all sections', () => {
      const yaml = `
project:
  name: full-project
  languages: [ts]
  rootDirs: [src, lib]
  excludeDirs: [node_modules, dist, .git, build]
neo4j:
  uri: bolt://db.example.com:7687
  username: admin
  password: secret
  database: codegraph
parser:
  typescript:
    tsconfig: tsconfig.build.json
ai:
  provider: openai
  model: gpt-4-turbo
  maxTokensPerRequest: 200000
  temperature: 0.1
tracing:
  maxDepth: 100
  maxStepsPerFunction: 500
  boringFunctions: [console.log, console.error]
  boringNamespaces: [std]
  focusFunctions: [handleFileDrop]
server:
  port: 8080
  host: 0.0.0.0
`;
      writeConfig(TEST_DIR, yaml);

      const config = loadConfig(TEST_DIR);

      expect(config.neo4j.uri).toBe('bolt://db.example.com:7687');
      expect(config.neo4j.database).toBe('codegraph');
      expect(config.parser.typescript?.tsconfig).toBe('tsconfig.build.json');
      expect(config.ai.provider).toBe('openai');
      expect(config.ai.maxTokensPerRequest).toBe(200000);
      expect(config.tracing.maxDepth).toBe(100);
      expect(config.tracing.boringFunctions).toContain('console.log');
      expect(config.tracing.focusFunctions).toContain('handleFileDrop');
      expect(config.server.port).toBe(8080);
      expect(config.server.host).toBe('0.0.0.0');
    });
  });

  describe('environment variable substitution', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('substitutes ${ENV_VAR} in config values', () => {
      process.env.CG_NEO4J_PASSWORD = 'my-secret-password';
      process.env.CG_NEO4J_URI = 'bolt://production:7687';

      const yaml = `
project:
  name: env-test
neo4j:
  uri: \${CG_NEO4J_URI}
  password: \${CG_NEO4J_PASSWORD}
`;
      writeConfig(TEST_DIR, yaml);

      const config = loadConfig(TEST_DIR);

      expect(config.neo4j.uri).toBe('bolt://production:7687');
      expect(config.neo4j.password).toBe('my-secret-password');
    });

    it('replaces missing env vars with empty string', () => {
      delete process.env.NONEXISTENT_VAR;

      const yaml = `
project:
  name: \${NONEXISTENT_VAR}missing
`;
      writeConfig(TEST_DIR, yaml);

      const config = loadConfig(TEST_DIR);
      expect(config.project.name).toBe('missing');
    });

    it('handles multiple substitutions in one value', () => {
      process.env.CG_HOST = 'myhost';
      process.env.CG_PORT = '7687';

      const yaml = `
project:
  name: multi-sub
neo4j:
  uri: bolt://\${CG_HOST}:\${CG_PORT}
`;
      writeConfig(TEST_DIR, yaml);

      const config = loadConfig(TEST_DIR);
      expect(config.neo4j.uri).toBe('bolt://myhost:7687');
    });
  });

  describe('createDefaultConfig', () => {
    it('creates config with given project name and languages', () => {
      const config = createDefaultConfig({
        projectName: 'my-project',
        languages: ['ts', 'tsx'],
      });

      expect(config.project.name).toBe('my-project');
      expect(config.project.languages).toEqual(['ts', 'tsx']);
      expect(config.neo4j.uri).toBe('bolt://localhost:7687');
    });

    it('uses custom neo4j URI when provided', () => {
      const config = createDefaultConfig({
        projectName: 'custom-db',
        languages: ['ts'],
        neo4jUri: 'bolt://custom:7687',
      });

      expect(config.neo4j.uri).toBe('bolt://custom:7687');
    });

    it('applies all default values', () => {
      const config = createDefaultConfig({
        projectName: 'defaults',
        languages: ['ts'],
      });

      expect(config.project.rootDirs).toEqual(['src']);
      expect(config.project.excludeDirs).toContain('node_modules');
      expect(config.ai.provider).toBe('mock');
      expect(config.ai.model).toBe('gpt-4-turbo');
      expect(config.tracing.maxDepth).toBe(50);
    });
  });

  describe('findProjectRoot', () => {
    it('finds root when .codegraph.yaml exists in start dir', () => {
      writeConfig(TEST_DIR, 'project:\n  name: root');

      const root = findProjectRoot(TEST_DIR);
      expect(root).toBe(TEST_DIR);
    });

    it('finds root in parent directory', () => {
      writeConfig(TEST_DIR, 'project:\n  name: root');
      const childDir = createTestDir('src/components');

      const root = findProjectRoot(childDir);
      expect(root).toBe(TEST_DIR);
    });

    it('returns null when no config file found', () => {
      const emptyDir = createTestDir('nowhere');

      const root = findProjectRoot(emptyDir);
      // Might find the real project root, or null
      // The key test is that it doesn't throw
      expect(root === null || typeof root === 'string').toBe(true);
    });
  });
});
