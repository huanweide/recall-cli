# recall-cli

> 终端命令历史智能 ghost 补全 —— **零依赖 · 纯本地 · 确定性 · 离线**

把你自己 shell 里敲过的命令，变成光标后面那行灰色的「ghost 补全」。就像 IDE 里写代码时的灰色提示，但你不需要记任何快捷键、不联网、不上传、不调 AI。

```
$ git pu█                                    （你刚敲了 git pu）
$ git pu git pull origin main               （灰色 ghost 自动浮现）
          └─ 按 Ctrl-F 接受 ─┘
```

---

## 一、真实功能

- **自动探测 shell**：支持 `zsh` / `bash` / `fish`，自动找 history 文件（也支持 `--history` 手动指定）。
- **智能排名**：按「前缀匹配 + 出现频率 + 最近使用」打分，越常用的命令越靠前。
- **真·ghost text（zsh）**：光标后实时浮现灰色补全，按 `Ctrl-F` 或 `→` 一键接受。
- **确定性**：同一个 history + 同一个前缀 = 永远同一个结果。可单测、可进 CI、可离线。
- **零依赖**：单个 Node 文件，不装任何 npm 包，不读网络，不碰你的命令内容。

子命令：

| 命令 | 作用 |
| --- | --- |
| `recall <前缀>` | 给出 ghost 补全候选（默认子命令） |
| `recall stats` | 历史统计：总条数 / 唯一命令 / Top 命令 |
| `recall paths` | 打印探测到的 shell 与 history 路径 |
| `recall help` | 帮助 |

选项：`--top N`（前 N 条）、`--plain`（只输出命令，供 shell 集成）、`--shell`、`--history`。

---

## 二、安装

需要 Node.js ≥ 18（无需 npm install）。

> 原文档写「Node ≥ 16」是错的：`node --test` 内置测试运行器自 Node 18 才引入，
> 而 `npm test` 依赖它。**运行 recall 本身**只需 Node 16+，只有跑测试需要 18+。
> package.json 的 `engines` 声明的是后者。

```bash
# 方式一：clone 后直接跑（推荐）
git clone https://github.com/huanweide/recall-cli.git
node recall-cli/index.js --history ~/.bash_history git

# 方式二：注册全局命令 recall
#   注意：本项目尚未发布到 npm。npm 上确实存在名为 recall 的第三方包
#   （fouad/recall，Node.js tracing 库），以及 recall-cli（srcspider 维护）。
#   所以不要用 npm 全局安装这两个名字 —— 会装到别人的包并抢占同名命令。
#   npm link 只注册本仓库的 bin，不会碰 registry 上的包：
git clone https://github.com/huanweide/recall-cli.git
cd recall-cli && npm link     # 注册 recall 命令，来源是本地这个仓库

# 方式三：单文件拿走即用（注意分支名是 master，不是 main）
curl -fsSL https://raw.githubusercontent.com/huanweide/recall-cli/master/index.js -o recall
chmod +x recall && mv recall /usr/local/bin/recall
```

> 想确认某个命令到底来自哪里：`which recall` 与 `recall paths` 都会告诉你实际读取的 history 文件。

---

## 退出码契约

| 退出码 | 含义 |
|--------|------|
| `0` | 成功（含「无匹配候选」——这是正常结果不是错误） |
| `1` | 运行错误：history 文件不存在 / 读不到 |
| `2` | **用法错误**：未知选项、选项缺取值、`--top` 非正整数、`--shell` 取值非法 |

拼错选项会明确报错，而不是被当成搜索关键词：

```bash
recall --topp git      # -> 退出码 2 + 「未知选项：--topp」
recall --top abc git   # -> 退出码 2 + 「--top 需要正整数」
```

---

## 三、快速开始

```bash
# 看看 git 开头你最常敲什么
recall git

# 只取第一条、纯命令（给 shell 集成用）
recall "docker compose" --top 1 --plain

# 历史健康度一览
recall stats
```

输出示例：

```
$ recall git
 1. git status        (score=0.8833, freq=42)
 2. git push origin main  (score=0.4417, freq=11)
 3. git pull --rebase  (score=0.31, freq=7)
```

---

## 四、Shell 集成

### zsh（推荐，真 ghost text）

把下面内容加到 `~/.zshrc` 末尾（或 `source shell/recall.zsh`）：

```zsh
source /path/to/recall-cli/shell/recall.zsh
```

效果：每敲一个字符，光标后实时浮现灰色补全；`Ctrl-F` 或 `→` 接受。

### bash（fzf 辅助）

bash 没有原生 ghost text，用 fzf 做「按需候选」（需先装 `fzf`）：

```bash
source /path/to/recall-cli/shell/recall.bash
```

效果：`Ctrl-F` 弹出你历史里匹配当前行首的候选列表，回车接受。

---

## 五、四问摘要（README 必带）

**1. 痛点是什么？**
终端里长命令、复杂管道、带参数的 docker/git 指令，每次都要从头敲或翻 `Ctrl-R` 盲找。history 越积越多，召回效率反而越低。IDE 早就有了「灰色 ghost 补全」，终端却几乎没有轻量离线方案。

**2. 为什么是现在？**
终端 AI 补全（Fig、Warp AI 等）要么收费、要么强制联网、要么重。隐私敏感的开发者越来越想要「不把我的命令发到云端」的本地方案。零依赖 + 确定性正好填补这个真空。

**3. 差异化红线（绝不退化为又一个 lint 玩具）**
- 不联网、不调 AI、不依赖任何服务——纯本地确定性排名；
- 单文件零 npm 依赖，比「装一坨包」的 shell 插件轻一个数量级；
- 真 ghost text（zsh POSTDISPLAY）是终端原生体验，不是「弹个框让你选」；
- 确定性使其可进 CI、可写单测，与随机 AI 补全形成硬边界。

**4. 为什么能长期维护？**
- 表面积小（一个排名函数 + 三种 history 解析），改起来零风险；
- 无外部依赖 = 无依赖过期、无供应链风险；
- 排名算法是纯函数，单测覆盖 zsh/bash/fish 解析与打分，回归可立即发现；
- 天然可扩展：未来加「跨机器 history 合并」「别名优先级」都只是加一个纯函数。

---

## 六、工作原理（一句话版）

读 history 文件 → 按 shell 格式解析成命令数组 → 聚合出 `{命令, 出现次数, 最后位置}` → 按「频率×0.65 + 最近度×0.35」打分 → 取前缀匹配的前 N 条。全程同步、本地、确定性。

---

## License

MIT

---

## 作者

由 **ReTr · 樊斯瑞** 维护 · [GitHub 主页](https://github.com/huanweide)

## CI 门禁用法

recall 不是「健康分」类体检工具（这句模板文案是从家族其它项目复制来的，recall 没有健康分）。
它在流水线里的正确用法是**冒烟验证 shell 集成是否还活着**：

```bash
# 1) 集成健康检查：确认能读 history 且能出候选（退出码 0）
recall --history "$HIST_FILE" git --plain | head -1 || exit $?

# 2) 断言候选非空：读不到 history 时应退 1，据此告警
[ -n "$(recall --history "$HIST_FILE" git --plain)" ] || { echo "recall 无候选"; exit 1; }

# 3) 区分「用错参数」与「环境坏了」：前者退 2，后者退 1
recall --history "$HIST_FILE" --top abc git || exit $?   # -> 2
```

本仓库自身的 CI（`.github/workflows/verify.yml`）跑的是：Node 18/20/22 × ubuntu/windows
的单测 + CLI 冒烟 + 零依赖自证 + README 链接与选项一致性检查。

## 赞助支持

如果这个项目帮到了你，欢迎 [点 Star](https://github.com/huanweide/recall-cli) 支持；也可微信扫码自愿赞助（收款码见 `sponsor/wechat-qr.png`，作者本人带 Tri 水印的码，纯静态图片、不含任何密钥）。

## 许可证

详见 [LICENSE](LICENSE)。
