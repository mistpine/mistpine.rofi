#!/bin/sh
# Runs inside the render image: dumps the themes as rofi resolves them.
#   /themes  this repository's themes/ (read-only)
#   /out     where the dumps and rofi's messages go
set -eu
Xvfb :9 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
for _ in $(seq 50); do [ -e /tmp/.X11-unix/X9 ] && break; sleep 0.1; done
export DISPLAY=:9

rofi -v | sed -n 's/^Version: //p' > /out/version

# 1. The full theme, installed by name as the README says.
mkdir -p "$HOME/.config/rofi" "$HOME/.local/share/rofi/themes"
cp /themes/mistpine.rasi /themes/mistpine-colors.rasinc "$HOME/.local/share/rofi/themes/"
printf '@theme "mistpine"\n' > "$HOME/.config/rofi/config.rasi"
timeout 20 rofi -dump-theme > /out/theme.rasi 2> /out/theme.err

# 2. The colors file on rofi's built-in layout, imported by its full path.
printf '@import "~/.local/share/rofi/themes/mistpine-colors.rasinc"\n' > "$HOME/.config/rofi/config.rasi"
timeout 20 rofi -dump-theme > /out/colors.rasi 2> /out/colors.err
