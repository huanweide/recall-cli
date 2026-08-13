# recall.bash —— bash 下的次优集成（bash 无原生 ghost text）
# 用法：source 本文件（或贴进 ~/.bashrc）
# 依赖：recall 命令在 PATH + fzf 已安装
# 说明：bash 不支持 POSTDISPLAY，这里用 fzf 做「按需候选列表」

_recall_fzf() {
  local choice
  choice=$(recall suggest "$READLINE_LINE" --top 20 --plain 2>/dev/null | fzf --height 40% --reverse --prompt="recall> ")
  if [[ -n "$choice" ]]; then
    READLINE_LINE="$choice"
    READLINE_POINT=${#READLINE_LINE}
  fi
}

bind -x '"\C-f": _recall_fzf'   # Ctrl-F 弹出候选，回车接受
