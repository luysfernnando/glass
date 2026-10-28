#!/bin/zsh
# A new Ghostty window, outside tmux and sluice, running Claude with this
# checkout of glass (the installed glass off): screenshots as plain Ghostty
# draws them.
#   scripts/plain-ghostty.sh                          # from anywhere, tmux too
#   GLASS_DEBUG=/tmp/glass.log scripts/plain-ghostty.sh
# `open` hands the window this shell's environment, so $TMUX is cleared
# first: left set, Claude Code takes the window for tmux and draws no picture.
repo=${0:A:h:h}
if [[ $1 != --inside ]]; then
  exec env -u TMUX -u TMUX_PANE -u STY -u ZMX_SESSION open -na Ghostty --args -e "${0:A}" --inside
fi
# NO_AUTO_TMUX=1 and NO_AUTO_SLUICE=1 skip a zshrc that attaches tmux or
# sluice; -il loads PATH
export NO_AUTO_TMUX=1 NO_AUTO_SLUICE=1 GLASS_REPO=$repo
unset TMUX TMUX_PANE STY ZMX_SESSION
cd "$repo" || exit 1
exec /bin/zsh -il -c 'command claude --plugin-dir "$GLASS_REPO" --settings '\''{"enabledPlugins":{"glass@glass":false}}'\'' ${GLASS_DEBUG:+--debug-file} $GLASS_DEBUG'
