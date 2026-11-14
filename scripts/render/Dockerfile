# The rofi environment for pnpm verify and pnpm render.
#   ubuntu:24.04 ships rofi 1.7.5, ubuntu:26.04 rofi 2.0.0.
ARG BASE=ubuntu:26.04
FROM ${BASE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      rofi xvfb hsetroot imagemagick \
      sway grim \
      fonts-jetbrains-mono papirus-icon-theme librsvg2-common \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*
