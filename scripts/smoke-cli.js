#!/usr/bin/env node
// spawn 级冒烟：真实跑进程，验证退出码契约与「拼错选项不被当成搜索前缀」。
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CLI = path.join(__dirname, '..', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-smoke-'));
const HIST = path.join(tmp, 'h.txt');
fs.writeFileSync(HIST, ['git status', 'git push origin main', 'git status', 'cd ~/proj', 'docker ps'].join('\n') + '\n');

let fails = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { console.error('  FAIL ' + name + (detail ? ' -> ' + detail : '')); fails++; }
}
function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', input: '' });
}

console.log('# 用法错误必须退 2');
for (const [desc, args] of [
  ['未知选项', ['--history', HIST, '--bogus']],
  ['拼错的 --topp', ['--history', HIST, '--topp', 'git']],
  ['--top abc', ['--history', HIST, '--top', 'abc', 'git']],
  ['--top 0', ['--history', HIST, '--top', '0', 'git']],
  ['--top 负数', ['--history', HIST, '--top', '-2', 'git']],
  ['--top 小数', ['--history', HIST, '--top', '1.5', 'git']],
  ['--top 缺值（末尾）', ['--history', HIST, 'git', '--top']],
  ['--shell 非法值', ['--history', HIST, '--shell', 'xml', 'git']],
  ['--shell 缺值', ['--history', HIST, '--shell']],
  ['--history 缺值', ['--history']],
  ['拼错的 --plainn', ['--history', HIST, '--plainn', 'git']],
]) {
  const r = run(args);
  check(desc + ' -> rc=2', r.status === 2, 'rc=' + r.status + ' stderr=' + (r.stderr || '').trim());
}

console.log('# 运行错误必须退 1');
for (const [desc, args] of [
  ['history 文件不存在', ['--history', path.join(tmp, 'nope.txt'), 'git']],
]) {
  const r = run(args);
  check(desc + ' -> rc=1', r.status === 1, 'rc=' + r.status + ' stderr=' + (r.stderr || '').trim());
}

console.log('# 正常路径 rc=0 且输出正确');
{
  const r = run(['--history', HIST, 'git']);
  check('前缀查询 rc=0', r.status === 0, 'rc=' + r.status + ' stderr=' + (r.stderr || '').trim());
  check('输出含 git status/push', /git (status|push)/.test(r.stdout), JSON.stringify(r.stdout));
  check('最常用命令排第一（git status 出现 2 次）', /1\. git status/.test(r.stdout), JSON.stringify(r.stdout));
}
{
  const r = run(['--history', HIST, 'git', '--plain']);
  // --plain 的语义是「只输出命令本身、不带 score/freq 标注」，不是「只输出一条」
  check('--plain 只输出命令（无 score 标注）',
    r.status === 0 && /git status/.test(r.stdout) && !/score=/.test(r.stdout) && !/\(x\d+\)/.test(r.stdout),
    JSON.stringify(r.stdout));
  check('--plain 保留全部候选', r.status === 0 && r.stdout.trim().split('\n').length >= 2,
    JSON.stringify(r.stdout));
}
{
  const r = run(['--history', HIST, 'git', '--top', '1']);
  check('--top 1 只出一条', r.status === 0 && r.stdout.trim().split('\n').length === 1, JSON.stringify(r.stdout));
}
{
  const r = run(['git', '--history', HIST]);
  check('选项在前后等价（不吞前缀）', r.status === 0 && /git (status|push)/.test(r.stdout), r.stderr);
}
{
  const r = run(['--history', HIST, 'stats']);
  check('stats 子命令', r.status === 0 && /总命令条数=5/.test(r.stdout), JSON.stringify(r.stdout));
}
{
  const r = run(['--history', HIST, 'paths']);
  check('paths 子命令', r.status === 0 && /shell/.test(r.stdout) && /history/.test(r.stdout), r.stderr);
}
{
  const r = run(['--history', HIST, '--shell', 'zsh', 'paths']);
  check('--shell zsh 生效', r.status === 0 && /zsh/.test(r.stdout), r.stderr);
}
{
  const r = run(['--history', HIST, 'zzz无匹配前缀']);
  check('无匹配时 rc=0 并提示', r.status === 0 && /无匹配候选/.test(r.stdout), r.stderr);
}
{
  const r = run(['--history', HIST, 'zzz', '--plain']);
  check('无匹配 + --plain 输出为空', r.status === 0 && r.stdout.trim() === '', JSON.stringify(r.stdout));
}
for (const h of ['help', '--help', '-h']) {
  const r = run([h]);
  check(h + ' rc=0 且有用法', r.status === 0 && /--top/.test(r.stdout), 'rc=' + r.status);
}

console.log('# 回归防线：拼错选项绝不能被当成搜索前缀');
{
  // 原实现把 --bogus 落进 positionals 当搜索词，返回「无匹配候选」且 rc=0
  const r = run(['--history', HIST, '--bogus', 'git']);
  check('拼错选项报错而非返回候选', r.status === 2 && !/无匹配候选/.test(r.stdout),
    'rc=' + r.status + ' stdout=' + JSON.stringify(r.stdout));
}

console.log('# 源码级防线：禁止 process.exit()（会截断 stdout）');
{
  const src = fs.readFileSync(CLI, 'utf8');
  const offenders = [];
  src.split('\n').forEach((line, i) => {
    if (/[^.\w]process\.exit\s*\(/.test(line)) offenders.push((i + 1) + ': ' + line.trim());
  });
  check('index.js 中无 process.exit()', offenders.length === 0, offenders.join(' | '));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails === 0 ? '\nALL_OK' : `\nFAILED: ${fails}`);
process.exitCode = fails === 0 ? 0 : 1;