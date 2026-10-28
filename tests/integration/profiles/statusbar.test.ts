import { describe, it, expect, beforeAll } from 'vitest';
import { dir as tmpDir } from 'tmp-promise';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';

// `statusbar` is an add-on that enables a Claude Code plugin: one role + statusbar installs
// the role's exact file tree, and only .claude/settings.json differs (marketplace + plugin).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const CLI_ENTRY = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js');
const SETTINGS = '.claude/settings.json';
const MARKETPLACE = { source: { source: 'github', repo: 'ian-exnodes/statusbar' } };

async function install(cwd: string, profiles: string[]) {
  return execa('node', [CLI_ENTRY, ...profiles, '--merge-strategy=overwrite', '--no-prompts'], { cwd });
}
async function fresh() {
  const { path: cwd } = await tmpDir({ unsafeCleanup: true });
  await execa('git', ['init', '-q'], { cwd });
  return cwd;
}
const read = (cwd: string, rel: string) => readFile(path.join(cwd, rel), 'utf8');
const settings = async (cwd: string) => JSON.parse(await read(cwd, SETTINGS));
const tree = (cwd: string) => fg('**/*', { cwd, dot: true, onlyFiles: true, ignore: ['.git/**'] });

describe('install statusbar add-on', () => {
  beforeAll(async () => {
    await execa('npm', ['-w', '@ennamjsc/agents-scaffold', 'run', 'build'], { cwd: REPO_ROOT, shell: true });
  });

  for (const roles of [['next'], ['agent-org'], ['ba', 'pm']]) {
    it(`${roles.join(' ')} + statusbar = ${roles.join(' ')} plus the plugin in settings.json`, async () => {
      const withAddon = await fresh();
      const alone = await fresh();
      const { exitCode, stdout } = await install(withAddon, [...roles, 'statusbar']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('statusbar enabled in .claude/settings.json');
      await install(alone, roles);
      const aloneFiles = await tree(alone);
      expect((await tree(withAddon)).sort()).toEqual([...aloneFiles].sort());
      const norm = async (cwd: string, rel: string) => (await read(cwd, rel)).split(JSON.stringify(cwd).slice(1, -1)).join('<CWD>');
      for (const rel of aloneFiles) {
        if (rel !== SETTINGS) expect(await norm(withAddon, rel), rel).toBe(await norm(alone, rel));
      }
      // Role settings (superpowers, hooks, agent-org's SubagentStop) survive; statusbar is added.
      const base = await settings(alone);
      expect(await settings(withAddon)).toEqual({
        ...base,
        extraKnownMarketplaces: { 'ian-exnodes': MARKETPLACE },
        enabledPlugins: { ...base.enabledPlugins, 'statusbar@ian-exnodes': true },
      });
    });
  }

  it('keeps the user\'s own settings and plugins', async () => {
    const cwd = await fresh();
    await mkdir(path.join(cwd, '.claude'), { recursive: true });
    await writeFile(path.join(cwd, SETTINGS), JSON.stringify({ model: 'opus', enabledPlugins: { 'mine@x': true } }));
    expect((await install(cwd, ['next', 'statusbar'])).exitCode).toBe(0);
    const s = await settings(cwd);
    expect(s.model).toBe('opus');
    expect(s.enabledPlugins).toMatchObject({ 'mine@x': true, 'statusbar@ian-exnodes': true });
  });

  it('alone, installs the shared base plus the plugin', async () => {
    const cwd = await fresh();
    expect((await install(cwd, ['statusbar'])).exitCode).toBe(0);
    expect((await settings(cwd)).enabledPlugins['statusbar@ian-exnodes']).toBe(true);
  });
});
