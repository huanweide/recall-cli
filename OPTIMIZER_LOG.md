# 优化器工作日志 — recall-cli

## Round 1 · 2026-10-16

**存活评估**：保留。atuin(18k) / zoxide(25k) / zsh-autosuggestions(5k) 都各有定位；本项目的「零依赖单文件 + 跨 shell + 可进 CI 的确定性排名」与需要插件栈的方案不冲突。

**方向**：单点深度特化 —— 把「确定性」这个唯一卖点做实。

### P0 · 最高危：拼错的选项会改变输出内容，且退出码 0

```
$ recall --history h.txt --topp git
 1. git status  (score=..., freq=2)     ← 用户以为在搜 git
 ...                                       实际搜的是「--topp」
$ echo $?
0                                        ← 还告诉我成功了
```

原实现里未知选项会落进 `positionals`，与搜索前缀混在一起。**对补全工具来说这是最坏的失败模式** ——
用户会直接按下 Tab 接受这份毫无意义的补全。

pagext / jpath 上也有同源问题，但那里是「参数错了但不影响语义」；这里是「参数错了会改变输出本身」，性质更重。

### P0 · 参数契约

`--top abc`（parseInt → NaN 后落回默认值）、`--top 0` / 负数 / 小数 / 缺值、`--shell xml`、`--history` 缺值 —— 原全部静默 exit 0。

补 `need()` + `UsageError` + 数值与枚举校验。

### P0 · README 死链

```
curl -fsSL https://raw.githubusercontent.com/huanweide/recall-cli/main/index.js -o recall
                                          ^^^^ 仓库默认分支是 master，这条必然 404
```

已修正，并加 CI 门禁：README 里出现的分支名必须等于 `gh api` 查到的真实默认分支。

### P0 · 隐私红线

仓库根目录有 `bin_hist.txt`，内容是真实命令历史（`git status` / `git push`）。
本项目主打「纯本地、不上传你的命令历史」—— 仓库里放着命令历史文件，与自身定位直接矛盾。已删除，
并把 `*.hist` / `.bash_history` / `.zsh_history` / `_history` 写进 `.gitignore` 作为防线。

### P0 · engines 契约错误（与 jpath 同源）

声明 `>=16` 但 test 依赖 `node --test`（Node 18 才引入）。改为 `>=18`，README 说明「运行本身只需 16+，跑测试需 18+」。

### 验证

- 单测 18 → **26 项全绿**
- 冒烟 **33 项 ALL_OK**
- 变异测试 **M1–M6 全部被拦截**
- README 三道门禁本地注入实测可抓回归

### 自身失误

1. **又是同一个坑**：把循环体抽成独立 `parse()` 后，`need()` 里引用块外的 `i`，报 `ReferenceError: i is not defined`。这是本轮第二次犯（jpath 那次是 `fileArg` 的 `null` / `undefined`）。
   → 共同教训写进 skill：**把循环体抽成独立函数时，闭包捕获的循环变量必须显式提到函数作用域，并让循环用同一个变量。**
2. 首版 CI 门禁用 `curl` 打 `raw.githubusercontent` 验链接 —— 外网依赖会让 CI 因网络抖动误红（本机代理还常年占着 7890）。改为 `gh api` 查真实默认分支做纯逻辑比对。
   → **门禁应验证「一致性」，而不是「外部状态」。**
