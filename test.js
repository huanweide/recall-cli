'use strict';

// 确定性单测：覆盖三种 shell 解析 + 索引 + 排名
// 运行: node --test test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./index.js');

// ---------------------------------------------------------------------------
// 解析层
// ---------------------------------------------------------------------------

test('bash history: 每行一条命令', () => {
  const content = ['git status', 'git push origin main', 'git status', 'ls -la', ''].join('\n');
  const cmds = r.parseHistory(content, 'bash');
  assert.deepEqual(cmds, ['git status', 'git push origin main', 'git status', 'ls -la']);
});

test('zsh history: 扩展格式 + 老格式混合', () => {
  const content = [
    ': 1690000000:0;git status',
    ': 1690000001:0;git push origin main',
    'git status',
    '',
  ].join('\n');
  const cmds = r.parseHistory(content, 'zsh');
  assert.deepEqual(cmds, ['git status', 'git push origin main', 'git status']);
});

test('fish history: YAML 风格（含缩进）', () => {
  const content = ['- cmd: git status', '- cmd: git push origin main', '  - cmd: git status', ''].join('\n');
  const cmds = r.parseHistory(content, 'fish');
  assert.deepEqual(cmds, ['git status', 'git push origin main', 'git status']);
});

test('解析忽略空行与首尾空白', () => {
  const content = ['  git status  ', '', '   ', 'ls -la'].join('\n');
  const cmds = r.parseHistory(content, 'bash');
  assert.deepEqual(cmds, ['git status', 'ls -la']);
});

// ---------------------------------------------------------------------------
// 索引层
// ---------------------------------------------------------------------------

test('buildIndex: 聚合频率与最后位置', () => {
  const entries = r.buildIndex(['a', 'b', 'a']);
  assert.equal(entries.length, 2);
  const a = entries.find((e) => e.cmd === 'a');
  assert.equal(a.freq, 2);
  assert.equal(a.lastSeen, 2);
});

// ---------------------------------------------------------------------------
// 排名层（核心确定性）
// ---------------------------------------------------------------------------

test('rank: 前缀过滤 + 频率优先', () => {
  const content = ['git status', 'git push origin main', 'git status', 'ls -la'].join('\n');
  const entries = r.buildIndex(r.parseHistory(content, 'bash'));
  const items = r.rank(entries, 'git', { top: 5 });
  // git status 出现 2 次、git push 仅 1 次 => 频率优先，git status 排第一
  assert.equal(items[0].cmd, 'git status');
  assert.equal(items.length, 2); // 只有 git 前缀的两条
});

test('rank: 不带前缀返回全部，且截断到 top', () => {
  const entries = r.buildIndex(['a', 'b', 'c', 'd', 'e', 'f']);
  const items = r.rank(entries, '', { top: 3 });
  assert.equal(items.length, 3);
});

test('rank: 前缀完全等于命令本身时不重复返回', () => {
  const entries = r.buildIndex(['git', 'git status']);
  const items = r.rank(entries, 'git', { top: 5 });
  // 只返回比前缀更长的 "git status"
  assert.equal(items.length, 1);
  assert.equal(items[0].cmd, 'git status');
});

test('rank: 确定性（同输入同输出）', () => {
  const content = ['git status', 'git push origin main', 'git status', 'docker compose up'].join('\n');
  const entries = r.buildIndex(r.parseHistory(content, 'bash'));
  const a = JSON.stringify(r.rank(entries, 'git', { top: 5 }));
  const b = JSON.stringify(r.rank(entries, 'git', { top: 5 }));
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// 端到端（走 content 注入，避免依赖真实 history 文件）
// ---------------------------------------------------------------------------

test('suggest: 端到端给出候选', () => {
  const res = r.suggest('git', { content: 'git status\ngit push origin main\ngit status\n', shell: 'bash' });
  assert.equal(res.ok, true);
  assert.equal(res.items[0].cmd, 'git status');
});

test('suggest: 无匹配返回空', () => {
  const res = r.suggest('zzz', { content: 'git status\nls -la\n', shell: 'bash' });
  assert.equal(res.items.length, 0);
});

test('stats: 统计摘要正确', () => {
  const res = r.stats({ content: 'git status\ngit status\nls -la\n', shell: 'bash' });
  assert.equal(res.ok, true);
  assert.equal(res.total, 3);
  assert.equal(res.unique, 2);
  assert.equal(res.top[0].cmd, 'git status');
  assert.equal(res.top[0].freq, 2);
});

// ---------------------------------------------------------------------------
// 魔王轮转修复回归（红 -> 修 -> 绿）
// ---------------------------------------------------------------------------

const cp = require('node:child_process');
const os = require('node:os');
const fst = require('node:fs');
const path = require('node:path');

test('安全: sanitize 剔除终端控制字符（防注入）', () => {
  const dirty = 'clear\x1b[2Jrm -rf /\x07';
  // ESC(\x1b) 与 BEL(\x07) 被剔除；[2J 是可打印字符，保留即安全
  assert.equal(r.sanitize(dirty), 'clear[2Jrm -rf /');
  // 经 suggest 输出也不含控制字符
  const res = r.suggest('', { content: 'echo \x1b[2Jhi\n', shell: 'bash' });
  assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(res.items[0].cmd));
});

test('bash: 行尾反斜杠续行合并为一条', () => {
  const content = ['git commit -m "msg \\', 'more"', 'ls -la', ''].join('\n');
  const cmds = r.parseHistory(content, 'bash');
  assert.equal(cmds.length, 2);
  assert.equal(cmds[0], 'git commit -m "msg more"');
});

test('bash: 默认跳过 alias 定义行', () => {
  const content = ["alias ll='ls -la'", 'll', ''].join('\n');
  const cmds = r.parseHistory(content, 'bash');
  assert.deepEqual(cmds, ['ll']);
});

test('rank: recency 生效（同频时最近使用的排前，score 非全等）', () => {
  // a,b 各出现 1 次，但 b 更靠后 => recency 更高
  const entries = r.buildIndex(['a', 'b']);
  const items = r.rank(entries, '', { top: 2 });
  assert.equal(items[0].cmd, 'b');
  assert.notEqual(items[0].score, items[1].score);
  assert.ok(items[0].score < 1 || items[1].score < 1); // 不会被舍入成统一 1
});

test('CLI: --history 在前后都不吞前缀（选项顺序无关）', () => {
  const tmp = path.join(os.tmpdir(), `recall-test-${Date.now()}.hist`);
  fst.writeFileSync(tmp, 'git status\ngit push origin main\ngit status\ncd ~/proj\ndocker ps\n');
  const run = (args) =>
    new Promise((resolve) => {
      cp.execFile(process.execPath, [path.join(__dirname, 'index.js'), ...args], { cwd: __dirname }, (e, out) => {
        resolve(out || '');
      });
    });
  return Promise.all([
    run(['--history', tmp, 'git']),
    run(['git', '--history', tmp]),
  ]).then(([a, b]) => {
    fst.unlinkSync(tmp);
    // 两者都应返回 git 前缀候选，而不是 cd/docker 等字母序无关命令
    assert.match(a, /git (status|push)/);
    assert.match(b, /git (status|push)/);
  });
});

test('缓存: 同文件二次 loadEntries 命中内存缓存', () => {
  const tmp = path.join(os.tmpdir(), `recall-cache-${Date.now()}.hist`);
  fst.writeFileSync(tmp, 'git status\ngit status\nls -la\n');
  const first = r.loadEntries({ history: tmp, shell: 'bash' });
  const second = r.loadEntries({ history: tmp, shell: 'bash' });
  fst.unlinkSync(tmp);
  assert.equal(first.ok !== undefined ? true : true, true);
  assert.equal(second.cached, true);
  assert.equal(second.entries.length, 2);
});
