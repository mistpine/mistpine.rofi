/**
 * Writes the rofi themes from the mistpine spec:
 *
 * - themes/mistpine-colors.rasinc: the colors alone, as the standard rofi
 *   variables (plus mistpine-* names), for your own layout or rofi's.
 * - themes/mistpine.rasi: the same colors block followed by src/layout.rasi,
 *   in one file so it installs with one download.
 *
 *   pnpm generate          write both files
 *   pnpm generate --check  fail if either file is out of date
 *
 * Every color comes from palette/mistpine.json in the reference repository
 * (see lib/colors.ts). Both files are linted against the rasi subset rofi
 * 1.7.5 and 2.0 share, and every text color against the background it can
 * sit on, before anything is written.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contrast, loadSpec, mix, ROOT, type Spec } from "./lib/colors.ts";
import { parseRasi } from "./lib/rasi.ts";

const check = process.argv.includes("--check");
const { spec, source } = await loadSpec();

/** A palette key (`bg1`) or a spec token (`ui.panelBg`). */
function token(key: string): { hex: string; ref?: string } {
  const [group, name] = key.includes(".") ? key.split(".", 2) : ["palette", key];
  const table = spec[group as keyof Spec] as Record<string, unknown> | undefined;
  const value = table?.[name as string];
  if (typeof value === "string") return { hex: value.toLowerCase(), ref: name };
  const t = value as { hex?: string; ref?: string } | undefined;
  if (!t?.hex) throw new Error(`the spec has no color ${key}`);
  return { hex: t.hex.toLowerCase(), ref: t.ref };
}
const color = (key: string) => token(key).hex;

/** The rofi variable for a palette key: `brightRed` → `mistpine-bright-red`. */
const paletteVar = (key: string) =>
  `mistpine-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** Recomputes the spec's blends, so the theme provably uses the spec's math. */
function verifyBlends(): void {
  const names: Record<string, string> = { "@terminal.background": color("terminal.background") };
  let checked = 0;
  for (const [name, t] of Object.entries(spec.ui)) {
    if (!t.derived) continue;
    const m = t.derived.match(/^mix\((\S+), \$(\w+), (\d+)%\)$/);
    if (!m) throw new Error(`ui.${name}: unknown blend ${t.derived}`);
    const [, base, key, pct] = m as unknown as [string, string, string, string];
    const got = mix(names[base] ?? color(base.replace(/^\$/, "")), color(key), Number(pct) / 100);
    if (got !== t.hex) throw new Error(`ui.${name}: ${t.derived} gives ${got}, spec says ${t.hex}`);
    checked++;
  }
  if (checked === 0) throw new Error("the spec has no blends: did its format change?");
}

// ---------------------------------------------------------------- mapping

/**
 * The variables, section by section: [rofi variable, spec token]. A token
 * that names a palette color is written as var(mistpine-<color>), so a
 * layout that overrides a palette variable follows through.
 */
const sections: { title: string[]; vars: [string, string][] }[] = [
  {
    title: [
      "Canvas: floating windows recede to bg0, as Neovim's floats and pickers",
      "do; text is fg3; borders and separators are bg4.",
    ],
    vars: [
      ["background", "ui.panelBg"],
      ["foreground", "ui.editorFg"],
      ["border-color", "ui.border"],
      ["separatorcolor", "ui.border"],
      ["scrollbar-handle", "ui.border"],
    ],
  },
  {
    title: ["Rows: no zebra striping, so alternate rows equal normal ones."],
    vars: [
      ["normal-background", "ui.panelBg"],
      ["normal-foreground", "ui.editorFg"],
      ["alternate-normal-background", "ui.panelBg"],
      ["alternate-normal-foreground", "ui.editorFg"],
    ],
  },
  {
    title: ["The selected row: bg3, the spec's selection, under fg3."],
    vars: [
      ["selected-normal-background", "ui.selection"],
      ["selected-normal-foreground", "ui.editorFg"],
    ],
  },
  {
    title: [
      "Active rows (dmenu -a, focused windows) are yellow, as marked entries",
      "in Neovim's pickers.",
    ],
    vars: [
      ["active-background", "ui.panelBg"],
      ["active-foreground", "ui.warning"],
      ["alternate-active-background", "ui.panelBg"],
      ["alternate-active-foreground", "ui.warning"],
      ["selected-active-background", "ui.selection"],
      ["selected-active-foreground", "ui.warning"],
    ],
  },
  {
    title: [
      "Urgent rows (dmenu -u, windows asking for attention) are red. Red is",
      "too dark on the selection (3.9:1), so a selected urgent row is filled.",
    ],
    vars: [
      ["urgent-background", "ui.panelBg"],
      ["urgent-foreground", "ui.error"],
      ["alternate-urgent-background", "ui.panelBg"],
      ["alternate-urgent-foreground", "ui.error"],
      ["selected-urgent-background", "ui.error"],
      ["selected-urgent-foreground", "ui.panelBg"],
    ],
  },
  {
    title: [
      "mistpine's own roles, used by themes/mistpine.rasi: the prompt in the",
      "accent, counters and placeholders muted, the selection caret and",
      "matches in orange, messages like a status line, errors in red.",
    ],
    vars: [
      ["mistpine-prompt", "ui.accent"],
      ["mistpine-muted", "fg1"],
      ["mistpine-caret", "orange"],
      ["mistpine-match", "orange"],
      ["mistpine-message-background", "ui.statusBg"],
      ["mistpine-message-foreground", "ui.statusFg"],
      ["mistpine-error", "ui.error"],
    ],
  },
];

/** Matched characters: bold orange (written as a value, see `highlight` below). */
const HIGHLIGHT_TOKEN = "orange";

// ---------------------------------------------------------------- output

const URL = "https://github.com/mistpine/mistpine.rofi";
const SPEC = "https://github.com/mistpine/mistpine/blob/main/palette/mistpine.json";

function colorsBlock(): string[] {
  const palette = Object.keys(spec.palette);
  const pad = (name: string) => `${name}:`.padEnd(30);
  const lines = ["* {", "    /* The mistpine palette. */"];
  for (const key of palette) lines.push(`    ${pad(paletteVar(key))}${color(key)};`);
  for (const { title, vars } of sections) {
    lines.push(
      "",
      ...title.map(
        (t, i, all) => (i === 0 ? "    /* " : "     * ") + t + (i === all.length - 1 ? " */" : ""),
      ),
    );
    for (const [name, key] of vars) {
      const { hex, ref } = token(key);
      if (ref && spec.palette[ref]?.toLowerCase() === hex) {
        lines.push(`    ${pad(name)}var(${paletteVar(ref)});`);
      } else {
        lines.push(`    ${pad(name)}${hex};`);
      }
    }
  }
  lines.push(
    "",
    "    /* Matched characters: bold orange (4.9:1 even on the selection). */",
    `    ${pad("highlight")}bold ${color(HIGHLIGHT_TOKEN)};`,
    "}",
  );
  return lines;
}

const colorsHeader = [
  "/**",
  " * mistpine-colors: the mistpine colors for rofi 1.7.5+, without a layout.",
  ` * ${URL} · MIT License`,
  " *",
  " * Save this file in ~/.local/share/rofi/themes/ and import it by its",
  " * full path, from config.rasi (after any @theme) or your own theme:",
  ' *   @import "~/.local/share/rofi/themes/mistpine-colors.rasinc"',
  " * rofi 1.7 cannot find a .rasinc file by name, so keep the full path.",
  " *",
  " * It sets the standard rofi color variables (background, foreground,",
  " * selected-normal-background, …) and mistpine-* names for the palette.",
  " *",
  " * Generated by scripts/generate.ts from the mistpine spec",
  ` * (${SPEC}).`,
  " * Do not edit by hand.",
  " */",
];

const themeHeader = [
  "/**",
  " * mistpine: the mistpine color scheme for rofi 1.7.5+.",
  ` * ${URL} · MIT License`,
  " *",
  " * Save this file as ~/.local/share/rofi/themes/mistpine.rasi, then add",
  ' * @theme "mistpine" to the end of ~/.config/rofi/config.rasi (or pick',
  " * it in rofi-theme-selector).",
  " *",
  " * Generated by scripts/generate.ts from the mistpine spec",
  ` * (${SPEC})`,
  " * and src/layout.rasi. Do not edit by hand.",
  " */",
];

const layoutSource = readFileSync(join(ROOT, "src", "layout.rasi"), "utf8");
// The layout's own header comment describes the source file; drop it.
const layout = layoutSource.replace(/^\/\*[\s\S]*?\*\/\n\n/, "");

const colors = `${[...colorsHeader, "", ...colorsBlock()].join("\n")}\n`;
const theme = `${[...themeHeader, "", ...colorsBlock(), ""].join("\n")}\n${layout}`;

// ---------------------------------------------------------------- lint

/** Widgets rofi 1.7.5 and 2.0 both have, with the states this theme styles. */
const WIDGETS = new Set([
  "*",
  "window",
  "mainbox",
  "inputbar",
  "prompt",
  "textbox-prompt-colon",
  "entry",
  "num-filtered-rows",
  "textbox-num-sep",
  "num-rows",
  "case-indicator",
  "message",
  "textbox",
  "error-message",
  "error-message textbox",
  "listview",
  "scrollbar",
  "element",
  "element-icon",
  "element-text",
  "mode-switcher",
  "button",
  "button selected",
  ...["normal", "alternate", "selected"].flatMap((a) =>
    ["normal", "active", "urgent"].map((b) => `element ${a}.${b}`),
  ),
]);

/** Properties from rofi-theme(5) for 1.7.5; rofi silently ignores typos. */
const PROPERTIES = new Set([
  "background-color",
  "text-color",
  "border",
  "border-color",
  "border-radius",
  "padding",
  "margin",
  "spacing",
  "children",
  "location",
  "anchor",
  "width",
  "lines",
  "columns",
  "fixed-height",
  "scrollbar",
  "handle-width",
  "handle-color",
  "size",
  "highlight",
  "placeholder",
  "placeholder-color",
  "str",
  "expand",
  "vertical-align",
  "cursor",
]);

const isColor = (v: string) => /^#[0-9a-f]{6}$/.test(v);

function lint(): void {
  verifyBlends();

  // The colors file: one * block, every value a #rrggbb or var() of the palette.
  const cb = parseRasi(colors, "themes/mistpine-colors.rasinc");
  if (cb.length !== 1 || cb[0]?.selector !== "*") {
    throw new Error("themes/mistpine-colors.rasinc must be a single * block");
  }
  const vars = cb[0].props;
  const resolve = (name: string, seen: string[] = []): string => {
    const v = vars.get(name);
    if (v === undefined) throw new Error(`var(${name}) is not defined`);
    if (seen.includes(name)) throw new Error(`var(${name}) refers to itself`);
    if (isColor(v)) return v;
    const ref = v.match(/^var\(([a-z0-9-]+)\)$/)?.[1];
    if (ref) return resolve(ref, [...seen, name]);
    throw new Error(`${name}: ${v} is not a #rrggbb color or a var()`);
  };
  for (const name of vars.keys()) if (name !== "highlight") resolve(name);
  if (vars.get("highlight") !== `bold ${color(HIGHLIGHT_TOKEN)}`) {
    throw new Error("highlight must be bold plus the match color");
  }

  // The layout: known widgets and properties, colors only through var().
  const lb = parseRasi(layoutSource, "src/layout.rasi");
  const layoutVars = new Set(lb.find((b) => b.selector === "*")?.props.keys() ?? []);
  for (const { selector, props } of lb) {
    if (!WIDGETS.has(selector)) throw new Error(`src/layout.rasi: unknown widget ${selector}`);
    for (const [prop, value] of props) {
      const at = `src/layout.rasi: ${selector} { ${prop} }`;
      if (!PROPERTIES.has(prop) && !(selector === "*" && prop.startsWith("mistpine-"))) {
        throw new Error(`${at}: unknown property`);
      }
      if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(value)) {
        throw new Error(`${at}: literal color; use a var() from the colors block`);
      }
      for (const [, ref] of value.matchAll(/var\(([a-z0-9-]+)\)/g)) {
        if (!vars.has(ref as string) && !layoutVars.has(ref as string)) {
          throw new Error(`${at}: var(${ref}) is not defined`);
        }
      }
    }
  }
  // The full theme must read back as exactly the colors block plus the layout.
  const tb = parseRasi(theme, "themes/mistpine.rasi");
  if (tb.length !== cb.length + lb.length) throw new Error("themes/mistpine.rasi lost a block");

  // Contrast: every text color on every background it can sit on.
  const c = (name: string) => resolve(name);
  const highlight = color(HIGHLIGHT_TOKEN);
  const pairs: [string, string, string][] = [];
  for (const row of ["normal", "alternate-normal", "selected-normal"]) {
    pairs.push([`${row}-foreground`, c(`${row}-foreground`), c(`${row}-background`)]);
    pairs.push([`highlight on ${row}`, highlight, c(`${row}-background`)]);
  }
  for (const kind of ["active", "urgent"]) {
    for (const row of [kind, `alternate-${kind}`, `selected-${kind}`]) {
      pairs.push([`${row}-foreground`, c(`${row}-foreground`), c(`${row}-background`)]);
      // Selected urgent rows underline matches in their own text color instead.
      if (row !== "selected-urgent") {
        pairs.push([`highlight on ${row}`, highlight, c(`${row}-background`)]);
      }
    }
  }
  pairs.push(
    ["prompt", c("mistpine-prompt"), c("background")],
    ["counter and placeholder", c("mistpine-muted"), c("background")],
    ["current mode", c("selected-normal-foreground"), c("selected-normal-background")],
    ["other modes", c("mistpine-muted"), c("background")],
    ["message", c("mistpine-message-foreground"), c("mistpine-message-background")],
    ["error text", c("foreground"), c("background")],
  );
  for (const [label, fg, bg] of pairs) {
    const ratio = contrast(fg, bg);
    if (ratio < 4.5)
      throw new Error(`${label}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below 4.5:1`);
  }
}

lint();

const outputs: [string, string][] = [
  ["themes/mistpine-colors.rasinc", colors],
  ["themes/mistpine.rasi", theme],
];
let stale = false;
for (const [file, text] of outputs) {
  const path = join(ROOT, file);
  if (check) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {}
    if (current !== text) {
      console.error(`${file} is out of date: run pnpm generate`);
      stale = true;
    }
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${file}`);
  }
}
if (stale) process.exit(1);
console.log(check ? `themes are up to date (spec: ${source})` : `spec: ${source}`);
