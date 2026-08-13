#!/usr/bin/env node
'use strict';

// recall-cli —— 终端命令历史智能 ghost 补全（零依赖 / 纯本地 / 确定性 / 离线）
//
// 把你自己的 shell history 变成 inline ghost text 候选：
//   - 不联网、不上传、不调用任何 AI；
//   - 不装任何 npm 包；
//   - 单文件 Node，挂到 zsh 里就是「终端版 Copilot 补全」。
//
// 设计铁律：确定性。同一个 history + 同一个前缀 => 永远同一个结果。
// 因此它可以进 CI、可以写单测、可以离线跑，不靠运气。

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_HISTORY_BYTES = 50 * 1024 * 1024; // 50MB 防御性上限，避免超大/二进制 OOM

// ---------------------------------------------------------------------------
// 0. 安全：剔除 C0 控制字符（防终端注入：history 里的 \x1b[2J 等）
// ---------------------------------------------------------------------------
function sanitize(s) {
  return String(s == null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

// ---------------------------------------------------------------------------
// 1. shell 探测
// ---------------------------------------------------------------------------

function detectShell() {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  if (shell.includes('bash')) return 'bash';
  return 'bash';
}

function historyPath(shell, explicit) {
  if (explicit) return explicit;
  const home = os.homedir();
  if (shell === 'zsh') return path.join(home, '.zsh_history');
  if (shell === 'fish') return path.join(home, '.local', 'share', 'fish', 'fish_history');
  return process.env.HISTFILE || path.join(home, '.bash_history');
}

// ---------------------------------------------------------------------------
// 2. history 解析（不同 shell 格式不同）
// ---------------------------------------------------------------------------

// 合并行尾反斜杠续行（所有 shell 通用），再按 shell 格式解析成纯命令数组
function parseHistory(content, shell, opts) {
  opts = opts || {};
  const ignoreAlias = opts.ignoreAlias !== false; // 默认跳过 alias 定义行

  const rawLines = String(content == null ? '' : content)
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim());

  // 续行合并：行以单个 \ 结尾则直接拼接下一行（去掉 \ 与换行，不加减字符）
  const lines = [];
  let buf = '';
  let continuing = false;
  for (const line of rawLines) {
    if (continuing) {
      buf += line;
      continuing = false;
    } else {
      if (buf) {
        lines.push(buf);
        buf = '';
      }
      buf = line;
    }
    if (buf.endsWith('\\')) {
      buf = buf.slice(0, -1);
      continuing = true;
    }
  }
  if (buf) lines.push(buf);

  const cmds = [];

  if (shell === 'zsh') {
    for (const line of lines) {
      const m = line.match(/^:\s*\d+:\d*;?(.*)$/);
      if (m) cmds.push(sanitize(m[1]));
      else if (!line.startsWith(':')) cmds.push(sanitize(line));
    }
  } else if (shell === 'fish') {
    for (const line of lines) {
      const m = line.match(/^\s*-\s+(?:cmd|command):\s*(.*)$/);
      if (m) cmds.push(sanitize(m[1]));
    }
  } else {
    // bash：跳过 alias 定义行，其余每行一条命令
    for (const line of lines) {
      if (ignoreAlias && line.startsWith('alias ')) continue;
      cmds.push(sanitize(line));
    }
  }

  return cmds.filter((c) => c.length > 0);
}

// ---------------------------------------------------------------------------
// 3. 索引与排名（确定性打分）
// ---------------------------------------------------------------------------

function buildIndex(cmds) {
  const map = new Map();
  cmds.forEach((raw, i) => {
    const cmd = raw.trim();
    if (!cmd) return;
    if (!map.has(cmd)) map.set(cmd, { cmd, freq: 0, lastSeen: i });
    const e = map.get(cmd);
    e.freq += 1;
    e.lastSeen = i;
  });
  return Array.from(map.values());
}

// 返回原始浮点 score（不 toFixed），排序才不会因为舍入失真
function rank(entries, prefix, opts) {
  opts = opts || {};
  const k = opts.top && opts.top > 0 ? opts.top : 5;
  const p = (prefix || '').trim();

  const filtered = p
    ? entries.filter((e) => e.cmd.startsWith(p) && e.cmd.length > p.length)
    : entries;

  if (filtered.length === 0) return [];

  const total = Math.max(1, entries.length);
  const maxFreq = Math.max(1, ...filtered.map((e) => e.freq));

  const scored = filtered.map((e) => {
    const freqScore = e.freq / maxFreq; // 0..1
    const recencyScore = e.lastSeen / total; // 0..1
    const score = freqScore * 0.65 + recencyScore * 0.35;
    return { cmd: e.cmd, freq: e.freq, score };
  });

  scored.sort((a, b) => b.score - a.score || b.freq - a.freq || a.cmd.localeCompare(b.cmd));
  return scored.slice(0, k);
}

// ---------------------------------------------------------------------------
// 4. 轻量缓存（mtime+size 失效；内存 + 文件双层，失败静默降级）
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(os.homedir(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'recall.json');
let _memCache = null;

function _readCacheFile() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function _writeCacheFile(obj) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj));
  } catch (_) {
    /* 缓存不可写：静默降级，不影响主功能 */
  }
}

// ---------------------------------------------------------------------------
// 5. 高层 API
// ---------------------------------------------------------------------------

function loadEntries(opts) {
  opts = opts || {};
  const shell = opts.shell || detectShell();

  // 注入模式（测试 / demo）：不走文件、不走缓存
  if (opts.content != null) {
    const cmds = parseHistory(opts.content, shell, opts);
    return { entries: buildIndex(cmds), shell, file: null, error: null, cached: false };
  }

  const file = historyPath(shell, opts.history);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (_) {
    return { entries: [], shell, file, error: 'HISTORY_NOT_FOUND', cached: false };
  }
  if (stat.size > MAX_HISTORY_BYTES) {
    return { entries: [], shell, file, error: 'HISTORY_TOO_LARGE', cached: false };
  }

  // 缓存命中？
  const cache = _memCache && _memCache[file] ? _memCache : _readCacheFile();
  if (cache[file] && cache[file].mtime === stat.mtimeMs && cache[file].size === stat.size) {
    return { entries: cache[file].entries, shell, file, error: null, cached: true };
  }

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return { entries: [], shell, file, error: 'HISTORY_NOT_FOUND', cached: false };
  }
  const cmds = parseHistory(content, shell, opts);
  const entries = buildIndex(cmds);

  const entry = { mtime: stat.mtimeMs, size: stat.size, entries };
  _memCache = _memCache || {};
  _memCache[file] = entry;
  const disk = _readCacheFile();
  disk[file] = entry;
  _writeCacheFile(disk);

  return { entries, shell, file, error: null, cached: false };
}

function suggest(prefix, opts) {
  opts = opts || {};
  const { entries, error } = loadEntries(opts);
  if (error) return { ok: false, error, items: [] };
  return { ok: true, items: rank(entries, prefix, opts) };
}

function stats(opts) {
  opts = opts || {};
  const { entries, shell, file, error } = loadEntries(opts);
  if (error) return { ok: false, error, total: 0, unique: 0, top: [] };
  const top = entries.slice().sort((a, b) => b.freq - a.freq).slice(0, opts.top || 10);
  return { ok: true, shell, file, total: entries.reduce((s, e) => s + e.freq, 0), unique: entries.length, top };
}

// ---------------------------------------------------------------------------
// 6. CLI
// ---------------------------------------------------------------------------

function formatItems(items, plain) {
  if (plain) return items.map((i) => i.cmd).join('\n');
  return items
    .map((i, idx) => `${String(idx + 1).padStart(2, ' ')}. ${i.cmd}  (score=${i.score.toFixed(4)}, freq=${i.freq})`)
    .join('\n');
}

function printHelp() {
  process.stdout.write(
    [
      'recall-cli —— 终端命令历史智能 ghost 补全（零依赖 / 离线 / 确定性）',
      '  * 仅本地读取你的 shell history，不联网 / 不上传 / 不调用 AI。',
      '',
      '用法:',
      '  recall [suggest] <前缀>     根据前缀给出 ghost 补全候选（默认子命令）',
      '  recall stats                查看历史统计（总条数 / 唯一命令 / Top 命令）',
      '  recall paths                打印探测到的 shell 与 history 路径',
      '  recall help                 显示本帮助',
      '',
      '选项（可放在任意位置，不影响前缀识别）:',
      '  --top N           返回前 N 条（默认 5）',
      '  --plain           只输出命令本身，便于 shell 集成',
      '  --shell zsh|bash|fish   强制指定 shell 类型',
      '  --history <path>        指定 history 文件路径',
      '',
      '示例:',
      '  recall git',
      '  recall "docker compose" --top 3 --plain',
      '  recall stats',
      '  recall --history ~/.bash_history git   # 选项在前在后都行',
    ].join('\n') + '\n'
  );
}

function main() {
  const argv = process.argv.slice(2);
  const positionals = [];
  const opts = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--top') opts.top = parseInt(argv[++i], 10);
    else if (a === '--plain') opts.plain = true;
    else if (a === '--shell') opts.shell = argv[++i];
    else if (a === '--history') opts.history = argv[++i];
    else if (a === 'help' || a === '-h' || a === '--help') {
      printHelp();
      return;
    } else {
      positionals.push(a);
    }
  }

  // 子命令仅在「首个非选项位置参 ∈ 已知集合」时生效；否则整体当前缀。
  // 这样 --history 等选项放在前缀前后都不会吞掉前缀。
  const KNOWN = ['suggest', 'stats', 'paths', 'help'];
  let sub = 'suggest';
  let prefix = '';
  if (positionals.length && KNOWN.includes(positionals[0])) {
    sub = positionals[0];
    prefix = positionals.slice(1).join(' ');
  } else {
    prefix = positionals.join(' ');
  }

  if (sub === 'help') {
    printHelp();
    return;
  }

  if (sub === 'paths') {
    const shell = opts.shell || detectShell();
    process.stdout.write(`shell   : ${shell}\n`);
    process.stdout.write(`history : ${historyPath(shell, opts.history)}\n`);
    return;
  }

  if (sub === 'stats') {
    const r = stats(opts);
    if (!r.ok) {
      process.stderr.write(`未能读取 history（${r.error}）。可加 --history <path> 指定文件。\n`);
      process.exit(1);
    }
    process.stdout.write(
      [
        `shell=${r.shell}  history=${r.file}`,
        `总命令条数=${r.total}  唯一命令=${r.unique}`,
        'Top 命令:',
        ...r.top.map((e, i) => `  ${i + 1}. ${e.cmd}  (x${e.freq})`),
      ].join('\n') + '\n'
    );
    return;
  }

  // 默认：suggest
  const r = suggest(prefix, opts);
  if (!r.ok) {
    process.stderr.write(`未能读取 history（${r.error}）。可加 --history <path> 指定文件。\n`);
    process.exit(1);
  }
  if (r.items.length === 0) {
    if (!opts.plain) process.stdout.write('（无匹配候选）\n');
    return;
  }
  process.stdout.write(formatItems(r.items, opts.plain) + '\n');
}

module.exports = {
  sanitize,
  detectShell,
  historyPath,
  parseHistory,
  buildIndex,
  rank,
  loadEntries,
  suggest,
  stats,
};

if (require.main === module) {
  main();
}
