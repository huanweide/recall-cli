# recall.zsh —— zsh 真·ghost text 集成
# 用法：source 本文件（或把内容贴进 ~/.zshrc）
# 依赖：recall 命令已在 PATH（见 README 安装）

# 每次光标前内容变化，计算 ghost 候选并显示为灰色 POSTDISPLAY
_recall_ghost() {
  local suggestion
  suggestion=$(recall suggest "$BUFFER" --top 1 --plain 2>/dev/null | head -1)
  if [[ -n "$suggestion" && "$suggestion" == "$BUFFER"* && ${#suggestion} -gt ${#BUFFER} ]]; then
    POSTDISPLAY=$'\033[38;5;244m'"${suggestion:${#BUFFER}}"$'\033[0m'
  else
    POSTDISPLAY=""
  fi
}

# 接受 ghost：把 BUFFER 替换为候选
_recall_accept() {
  local suggestion
  suggestion=$(recall suggest "$BUFFER" --top 1 --plain 2>/dev/null | head -1)
  if [[ -n "$suggestion" && "$suggestion" == "$BUFFER"* ]]; then
    BUFFER="$suggestion"
    CURSOR=${#BUFFER}
  fi
  POSTDISPLAY=""
  zle redisplay
}

zle -N _recall_ghost
zle -N _recall_accept

# line-pre-redraw 钩子：每次重绘时刷新 ghost
autoload -Uz add-zle-hook-widget 2>/dev/null
add-zle-hook-widget line-pre-redraw _recall_ghost 2>/dev/null

# 绑定接受键
bindkey '^F' _recall_accept        # Ctrl-F 接受
bindkey '\e[C' _recall_accept       # 右方向键也接受
