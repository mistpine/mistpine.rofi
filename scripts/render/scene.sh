#!/bin/sh
# Runs inside the render image: shows one scene in real rofi and screenshots it.
#   scene.sh <scene> [x11|wayland]
#     x11      Xvfb, no compositor: rounded corners show black, as on a real
#              X11 desktop without one. Used for pixel checks.
#     wayland  headless sway, which composites: the README images.
#   /themes  this repository's themes/ (read-only)
#   /out     where <scene>.png goes
# Scenes: preview (drun), dmenu, colors (mistpine-colors.rasinc on rofi's
# built-in layout).
set -eu
scene=$1
backend=${2:-x11}
CANVAS='#0b1f27' # bg1, the spec's canvas, so the window shows on a desktop

# ---------------------------------------------------------------- sample apps
# A private XDG data dir: our .desktop files plus the system icons and MIME
# database and glycin loaders (gdk-pixbuf needs them for SVG), so drun
# lists only these.
DATA=/tmp/data
mkdir -p "$DATA/applications" "$HOME/.config/rofi" "$HOME/.local/share/rofi/themes"
ln -sf /usr/share/icons "$DATA/icons"
ln -sf /usr/share/mime "$DATA/mime"
[ -d /usr/share/glycin-loaders ] && ln -sf /usr/share/glycin-loaders "$DATA/glycin-loaders"
app() {
  printf '[Desktop Entry]\nType=Application\nName=%s\nExec=true\nIcon=%s\n' "$2" "$3" \
    > "$DATA/applications/$1.desktop"
}
app firefox Firefox firefox
app files Files org.gnome.Nautilus
app ghostty Ghostty com.mitchellh.ghostty
app nvim Neovim nvim
app obsidian Obsidian obsidian
app gimp GIMP gimp
app inkscape Inkscape inkscape
app krita Krita krita
app blender Blender blender
app thunderbird Thunderbird thunderbird
app calculator Calculator org.gnome.Calculator
app calendar Calendar org.gnome.Calendar
app weather Weather org.gnome.Weather
app editor "Text Editor" org.gnome.TextEditor
app settings Settings org.gnome.Settings
app btop btop btop
app keepassxc KeePassXC keepassxc
app zotero Zotero zotero
app audacity Audacity audacity
app darktable darktable darktable
export XDG_DATA_DIRS=$DATA XDG_CACHE_HOME=/tmp/cache

# ---------------------------------------------------------------- rofi config
cp /themes/mistpine.rasi /themes/mistpine-colors.rasinc "$HOME/.local/share/rofi/themes/"
config() {
  cat > "$HOME/.config/rofi/config.rasi" <<CFG
configuration {
    font:              "JetBrains Mono 12";
    show-icons:        true;
    icon-theme:        "Papirus-Dark";
    drun-match-fields: "name";
    modes:             "drun,run,window";
    $1
}
$2
CFG
}
case $scene in
  colors) config "" '@import "~/.local/share/rofi/themes/mistpine-colors.rasinc"' ;;
  *) config "" '@theme "mistpine"' ;;
esac

# ---------------------------------------------------------------- display
if [ "$backend" != wayland ]; then
  Xvfb :9 -screen 0 2000x1400x24 -dpi 192 -nolisten tcp >/dev/null 2>&1 &
  for _ in $(seq 50); do [ -e /tmp/.X11-unix/X9 ] && break; sleep 0.1; done
  export DISPLAY=:9
  hsetroot -solid "$CANVAS" >/dev/null
  DPI="-dpi 192"
else
  export XDG_RUNTIME_DIR=/tmp/xdg && mkdir -p -m 700 $XDG_RUNTIME_DIR
  printf 'output * resolution 2000x1400 scale 2 bg %s solid_color\n' "$CANVAS" > /tmp/sway.conf
  WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 \
    sway -c /tmp/sway.conf >/tmp/sway.log 2>&1 &
  for _ in $(seq 100); do [ -e $XDG_RUNTIME_DIR/wayland-1 ] && break; sleep 0.1; done
  export WAYLAND_DISPLAY=wayland-1
  unset DISPLAY
  DPI=""
fi

# ---------------------------------------------------------------- scene
case $scene in
  preview | colors)
    rofi $DPI -show drun -filter o &
    ;;
  dmenu)
    printf '%s\n' main feat/initial-theme fix/rounded-corners hotfix/fog-alert \
      docs/install chore/deps |
      rofi $DPI -dmenu -p "git switch" -mesg "6 branches · enter switches · main is checked out" \
        -a 0 -u 3 -selected-row 3 &
    ;;
  *) echo "unknown scene $scene" >&2; exit 2 ;;
esac
sleep 2
png="/out/$scene-$backend.png"
if [ "$backend" = wayland ]; then
  grim "$png"
else
  import -window root "$png"
fi
# Raw pixels and size for the checks in render.ts.
convert "$png" -depth 8 "rgb:${png%.png}.rgb"
identify -format '%w %h\n' "$png" > "${png%.png}.size"
