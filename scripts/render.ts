/**
 * Renders the README images from rofi itself and checks their pixels:
 *
 * - assets/preview.png: drun with icons, a filter and the mode tabs.
 * - assets/screenshots/dmenu.png: dmenu with a message, an active (yellow)
 *   and a selected urgent (red) row.
 * - assets/screenshots/colors.png: mistpine-colors.rasinc on rofi's
 *   built-in layout.
 *
 * Everything runs in Docker (scripts/render/Dockerfile, scene.sh). The README
 * images come from rofi 2.0 on headless sway, which composites, so the
 * rounded corners are real. The same scenes also run on X11 (Xvfb) with rofi
 * 1.7.5 and 2.0, for the pixel checks only.
 *
 * Every screenshot must contain the theme's colors exactly, or the render
 * fails. The colors are read back from themes/mistpine-colors.rasinc, which
 * pnpm verify ties to the spec.
 *
 *   pnpm render
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { image } from "@mistpine/port-kit/docker";
import { parseRasi } from "./lib/rasi.ts";

const ROOT = join(import.meta.dirname, "..");

const WORK = join(ROOT, ".render");
const ASSETS = join(ROOT, "assets");

// ---------------------------------------------------------------- theme colors

const colorsFile = readFileSync(join(ROOT, "themes", "mistpine-colors.rasinc"), "utf8");
const vars = parseRasi(colorsFile, "themes/mistpine-colors.rasinc")[0]?.props ?? new Map();
function v(name: string): string {
  const value = vars.get(name);
  if (!value) throw new Error(`themes/mistpine-colors.rasinc has no ${name}`);
  const ref = value.match(/^var\(([a-z0-9-]+)\)$/)?.[1];
  return ref ? v(ref) : value;
}
const CANVAS = v("mistpine-bg1");

// ---------------------------------------------------------------- scenes

interface Expect {
  label: string;
  hex: string;
  min: number;
}

interface Scene {
  name: "preview" | "dmenu" | "colors";
  /** Where the Wayland render goes, relative to assets/. */
  asset: string;
  expect: Expect[];
}

const SCENES: Scene[] = [
  {
    name: "preview",
    asset: "preview.png",
    expect: [
      { label: "window background", hex: v("background"), min: 200_000 },
      { label: "selected row and current mode", hex: v("selected-normal-background"), min: 60_000 },
      { label: "border and separator", hex: v("border-color"), min: 1_500 },
      { label: "selection caret and matches", hex: v("mistpine-caret"), min: 300 },
      { label: "prompt", hex: v("mistpine-prompt"), min: 100 },
      { label: "text", hex: v("foreground"), min: 500 },
      { label: "counter and modes", hex: v("mistpine-muted"), min: 100 },
    ],
  },
  {
    name: "dmenu",
    asset: "screenshots/dmenu.png",
    expect: [
      { label: "window background", hex: v("background"), min: 200_000 },
      { label: "message bar", hex: v("mistpine-message-background"), min: 40_000 },
      { label: "message text", hex: v("mistpine-message-foreground"), min: 100 },
      { label: "selected urgent row", hex: v("selected-urgent-background"), min: 40_000 },
      { label: "active row", hex: v("active-foreground"), min: 50 },
      { label: "placeholder", hex: v("mistpine-muted"), min: 50 },
    ],
  },
  {
    name: "colors",
    asset: "screenshots/colors.png",
    expect: [
      { label: "window background", hex: v("background"), min: 200_000 },
      { label: "selected row", hex: v("selected-normal-background"), min: 20_000 },
      { label: "text", hex: v("foreground"), min: 500 },
    ],
  },
];

/** [Ubuntu release, backend]: the README renders come from the first. */
const RUNS: [string, "wayland" | "x11"][] = [
  ["26.04", "wayland"],
  ["26.04", "x11"],
  ["24.04", "x11"],
];

// ---------------------------------------------------------------- pixels

interface Image {
  width: number;
  height: number;
  rgb: Buffer;
}

function load(base: string): Image {
  const [width, height] = readFileSync(`${base}.size`, "utf8").trim().split(" ").map(Number) as [
    number,
    number,
  ];
  const rgb = readFileSync(`${base}.rgb`);
  if (rgb.length !== width * height * 3) throw new Error(`${base}: unexpected pixel data size`);
  return { width, height, rgb };
}

const hexAt = (img: Image, i: number) =>
  `#${[0, 1, 2].map((k) => (img.rgb[i * 3 + k] as number).toString(16).padStart(2, "0")).join("")}`;

function count(img: Image, hex: string): number {
  let n = 0;
  for (let i = 0; i < img.width * img.height; i++) if (hexAt(img, i) === hex) n++;
  return n;
}

/** The smallest box around everything that is not the canvas. */
function bbox(img: Image): [number, number, number, number] {
  let [x0, y0, x1, y1] = [img.width, img.height, -1, -1];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (hexAt(img, y * img.width + x) === CANVAS) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) throw new Error("the screenshot is empty: rofi did not show");
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------- run

rmSync(WORK, { recursive: true, force: true });
mkdirSync(join(ASSETS, "screenshots"), { recursive: true });
const failures: string[] = [];

for (const [release, backend] of RUNS) {
  const tag = image({ name: "mistpine-rofi", release, context: join(ROOT, "scripts", "render") });
  const out = join(WORK, `${release}-${backend}`);
  mkdirSync(out, { recursive: true });
  for (const scene of SCENES) {
    const label = `${scene.name} (ubuntu:${release}, ${backend})`;
    // The README's colors-only scene needs only one render.
    if (scene.name === "colors" && backend !== "wayland") continue;
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--init",
        "-v",
        `${join(ROOT, "themes")}:/themes:ro`,
        "-v",
        `${join(ROOT, "scripts", "render", "scene.sh")}:/scene.sh:ro`,
        "-v",
        `${out}:/out`,
        "--user",
        `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
        "-e",
        "HOME=/tmp/home",
        tag,
        "sh",
        "/scene.sh",
        scene.name,
        backend,
      ],
      { stdio: ["ignore", "ignore", "ignore"], timeout: 120_000 },
    );
    const base = join(out, `${scene.name}-${backend}`);
    const img = load(base);
    const fails: string[] = [];
    for (const { label: what, hex, min } of scene.expect) {
      const n = count(img, hex);
      if (n < min) fails.push(`${what} ${hex}: ${n} exact pixels, want ≥ ${min}`);
    }
    const [x0, y0, x1, y1] = bbox(img);
    if (backend === "wayland") {
      // Rounded corners: the window's bounding box corner is still canvas.
      const corner = hexAt(img, y0 * img.width + x0);
      if (corner !== CANVAS && scene.name !== "colors") {
        fails.push(`top-left corner is ${corner}, not the canvas: corners are not rounded`);
      }
    }
    if (fails.length) {
      failures.push(`${label}:\n  ${fails.join("\n  ")}`);
      console.log(`✗ ${label}`);
      continue;
    }
    console.log(`✓ ${label}`);

    if (release === "26.04" && backend === "wayland") {
      const margin = 64;
      const [cx, cy] = [Math.max(0, x0 - margin), Math.max(0, y0 - margin)];
      const [cw, ch] = [
        Math.min(img.width, x1 + margin + 1) - cx,
        Math.min(img.height, y1 + margin + 1) - cy,
      ];
      execFileSync(
        "docker",
        [
          "run",
          "--rm",
          "-v",
          `${out}:/out`,
          "-v",
          `${ASSETS}:/assets`,
          "--user",
          `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
          tag,
          "convert",
          `/out/${scene.name}-${backend}.png`,
          "-crop",
          `${cw}x${ch}+${cx}+${cy}`,
          "+repage",
          "-strip",
          `/assets/${scene.asset}`,
        ],
        { stdio: "inherit" },
      );
    }
  }
}

if (failures.length) {
  console.error(`render: pixel checks failed\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("wrote assets/preview.png and assets/screenshots/{dmenu,colors}.png");
