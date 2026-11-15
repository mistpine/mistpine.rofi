/**
 * Checks the themes with rofi itself, in Docker: rofi 1.7.5 (Ubuntu 24.04)
 * and rofi 2.0.0 (Ubuntu 26.04).
 *
 *   pnpm verify                  both versions
 *   pnpm verify -- 26.04         one Ubuntu release
 *
 * In each, under Xvfb:
 * 1. themes/mistpine.rasi, installed by name as the README says, must load
 *    with no rofi warnings, and every color rofi resolves must be a spec
 *    color: the variables to their spec tokens, the widgets to the roles the
 *    layout gives them.
 * 2. themes/mistpine-colors.rasinc, imported by its full path over rofi's
 *    built-in layout, must load cleanly and set every standard variable.
 *
 * rofi exits 0 even when it cannot parse a theme; it only warns on stderr,
 * so any warning fails the check.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSpec } from "@mistpine/port-kit";
import { image } from "@mistpine/port-kit/docker";
import { parseRasi } from "./lib/rasi.ts";

const ROOT = join(import.meta.dirname, "..");

const RELEASES = { "24.04": "1.7.5", "26.04": "2.0.0" } as const;
type Release = keyof typeof RELEASES;

const asked = process.argv.slice(2).filter((a) => a !== "--");
const releases = (asked.length ? asked : Object.keys(RELEASES)) as Release[];
for (const r of releases) if (!(r in RELEASES)) fail(`unknown release ${r}: use 24.04 or 26.04`);

function fail(message: string): never {
  console.error(`verify: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- expectations

const { spec } = await loadSpec(ROOT);
const ui = (name: string) => {
  const hex = spec.ui[name]?.hex;
  if (!hex) fail(`the spec has no ui.${name}`);
  return hex.toLowerCase();
};
const pal = (name: string) => {
  const hex = spec.palette[name];
  if (!hex) fail(`the spec has no palette.${name}`);
  return hex.toLowerCase();
};

/** The standard variables and what the spec says they are (the README's table). */
const VARIABLES: Record<string, string> = {
  background: ui("panelBg"),
  foreground: ui("editorFg"),
  "border-color": ui("border"),
  separatorcolor: ui("border"),
  "scrollbar-handle": ui("border"),
  "normal-background": ui("panelBg"),
  "normal-foreground": ui("editorFg"),
  "alternate-normal-background": ui("panelBg"),
  "alternate-normal-foreground": ui("editorFg"),
  "selected-normal-background": ui("selection"),
  "selected-normal-foreground": ui("editorFg"),
  "active-background": ui("panelBg"),
  "active-foreground": ui("warning"),
  "alternate-active-background": ui("panelBg"),
  "alternate-active-foreground": ui("warning"),
  "selected-active-background": ui("selection"),
  "selected-active-foreground": ui("warning"),
  "urgent-background": ui("panelBg"),
  "urgent-foreground": ui("error"),
  "alternate-urgent-background": ui("panelBg"),
  "alternate-urgent-foreground": ui("error"),
  "selected-urgent-background": ui("error"),
  "selected-urgent-foreground": ui("panelBg"),
};

/** Widget colors in the full theme: [selector, property, expected]. */
const WIDGETS: [string, string, string][] = [
  ["window", "background-color", ui("panelBg")],
  ["window", "border-color", ui("border")],
  ["inputbar", "border-color", ui("border")],
  ["prompt", "text-color", ui("accent")],
  ["textbox-prompt-colon", "text-color", ui("accent")],
  ["entry", "text-color", ui("editorFg")],
  ["entry", "placeholder-color", pal("fg1")],
  ["num-filtered-rows", "text-color", pal("fg1")],
  ["message", "background-color", ui("statusBg")],
  ["textbox", "text-color", ui("statusFg")],
  ["error-message", "border-color", ui("error")],
  ["scrollbar", "handle-color", ui("border")],
  ["element normal.normal", "background-color", ui("panelBg")],
  ["element normal.normal", "text-color", ui("editorFg")],
  ["element selected.normal", "background-color", ui("selection")],
  ["element selected.normal", "border-color", pal("orange")],
  ["element normal.active", "text-color", ui("warning")],
  ["element normal.urgent", "text-color", ui("error")],
  ["element selected.urgent", "background-color", ui("error")],
  ["element selected.urgent", "text-color", ui("panelBg")],
  ["button", "text-color", pal("fg1")],
  ["button selected", "background-color", ui("selection")],
];

// ---------------------------------------------------------------- resolving

const hex2 = (n: string) => Number(n).toString(16).padStart(2, "0");

/** Resolves a dumped value (var() chains, rgba) to #rrggbb, or returns it as is. */
function resolver(blocks: ReturnType<typeof parseRasi>, file: string) {
  const vars = new Map<string, string>();
  for (const b of blocks) if (b.selector === "*") for (const [k, v] of b.props) vars.set(k, v);
  const resolve = (value: string, depth = 0): string => {
    if (depth > 20) throw new Error(`${file}: var() loop at ${value}`);
    const ref = value.match(/^var\(\s*([a-zA-Z0-9-]+)\s*\)$/)?.[1];
    if (ref) {
      const next = vars.get(ref);
      if (next === undefined) throw new Error(`${file}: var(${ref}) is not defined`);
      return resolve(next, depth + 1);
    }
    const rgba = value.match(/^rgba \( (\d+), (\d+), (\d+), (\d+) % \)$/);
    if (rgba) {
      if (rgba[4] !== "100") throw new Error(`${file}: ${value} is not opaque`);
      return `#${hex2(rgba[1] as string)}${hex2(rgba[2] as string)}${hex2(rgba[3] as string)}`;
    }
    return value;
  };
  const prop = (selector: string, name: string): string => {
    const value = blocks.find((b) => b.selector === selector)?.props.get(name);
    if (value === undefined) throw new Error(`${file}: ${selector} has no ${name}`);
    return resolve(value);
  };
  return { vars, resolve, prop };
}

function checkVariables(r: ReturnType<typeof resolver>, label: string): void {
  for (const [name, want] of Object.entries(VARIABLES)) {
    const value = r.vars.get(name);
    if (value === undefined) fail(`${label}: rofi has no ${name}`);
    const got = r.resolve(value);
    if (got !== want) fail(`${label}: ${name} resolves to ${got}, the spec says ${want}`);
  }
}

function warnings(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => /WARNING|CRITICAL|ERROR|error/i.test(l))
    .join("\n");
}

// ---------------------------------------------------------------- run

const specColors = new Set([
  ...Object.values(spec.palette).map((h) => h.toLowerCase()),
  ...Object.values(spec.ui).map((t) => t.hex.toLowerCase()),
]);

for (const release of releases) {
  const tag = image({ name: "mistpine-rofi", release, context: join(ROOT, "scripts", "render") });
  const out = mkdtempSync(join(tmpdir(), "mistpine-rofi-verify-"));
  try {
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--init",
        "-v",
        `${join(ROOT, "themes")}:/themes:ro`,
        "-v",
        `${join(ROOT, "scripts", "verify", "dump.sh")}:/dump.sh:ro`,
        "-v",
        `${out}:/out`,
        "--user",
        `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
        "-e",
        "HOME=/tmp/home",
        tag,
        "sh",
        "/dump.sh",
      ],
      { stdio: ["ignore", "inherit", "inherit"], timeout: 120_000 },
    );
    const version = readFileSync(join(out, "version"), "utf8").trim();
    if (version !== RELEASES[release]) fail(`ubuntu:${release} has rofi ${version}`);
    console.log(`rofi ${version} (ubuntu:${release})`);

    // 1. The full theme.
    let w = warnings(join(out, "theme.err"));
    if (w) fail(`rofi ${version} warned about themes/mistpine.rasi:\n${w}`);
    const themeDump = readFileSync(join(out, "theme.rasi"), "utf8");
    const theme = resolver(parseRasi(themeDump, "theme dump"), "theme dump");
    checkVariables(theme, `mistpine.rasi on rofi ${version}`);
    for (const [selector, name, want] of WIDGETS) {
      const got = theme.prop(selector, name);
      if (got !== want) fail(`rofi ${version}: ${selector} ${name} is ${got}, want ${want}`);
    }
    const hl = theme.prop("element normal.normal", "highlight");
    const hlColor = hl.match(/rgba \([^)]*\)/)?.[0];
    if (!hl.startsWith("bold") || !hlColor || theme.resolve(hlColor) !== pal("orange")) {
      fail(`rofi ${version}: matches are highlighted as "${hl}", want bold orange`);
    }
    // No color outside the spec anywhere in the resolved theme.
    for (const m of themeDump.matchAll(/rgba \([^)]*\)/g)) {
      const color = theme.resolve(m[0]);
      if (!specColors.has(color)) fail(`rofi ${version}: ${color} is not a mistpine color`);
    }
    console.log(
      `  mistpine.rasi: no warnings, ${Object.keys(VARIABLES).length} variables and ${WIDGETS.length} widget colors match the spec`,
    );

    // 2. The colors file on the built-in layout.
    w = warnings(join(out, "colors.err"));
    if (w) fail(`rofi ${version} warned about themes/mistpine-colors.rasinc:\n${w}`);
    const colorsDump = parseRasi(readFileSync(join(out, "colors.rasi"), "utf8"), "colors dump");
    if (!colorsDump.some((b) => b.selector === "window")) {
      fail(`rofi ${version}: the colors file replaced the built-in layout`);
    }
    checkVariables(
      resolver(colorsDump, "colors dump"),
      `mistpine-colors.rasinc on rofi ${version}`,
    );
    console.log("  mistpine-colors.rasinc: no warnings, every standard variable matches the spec");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
