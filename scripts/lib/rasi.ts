/**
 * A small reader for flat rasi: the files this repository writes and
 * `rofi -dump-theme` output. No @media or nested blocks.
 */

export interface Block {
  selector: string;
  props: Map<string, string>;
}

/** Blocks in file order; a block with several selectors appears once per selector. */
export function parseRasi(text: string, file: string): Block[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const blocks: Block[] = [];
  const re = /([^{}]+?)\s*\{([^{}]*)\}/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const between = src.slice(last, m.index).trim();
    if (between)
      throw new Error(`${file}: unexpected text before a block: ${between.slice(0, 40)}`);
    last = re.lastIndex;
    const [, rawSelectors, body] = m as unknown as [string, string, string];
    const props = new Map<string, string>();
    for (const decl of body.split(";")) {
      if (!decl.trim()) continue;
      const d = decl.trim().match(/^([a-z0-9-]+)\s*:\s*(.+)$/s);
      if (!d) throw new Error(`${file}: not a "property: value" declaration: ${decl.trim()}`);
      const [, prop, value] = d as unknown as [string, string, string];
      if (props.has(prop)) throw new Error(`${file}: ${rawSelectors.trim()} sets ${prop} twice`);
      props.set(prop, value.trim().replace(/\s+/g, " "));
    }
    for (const selector of rawSelectors.split(","))
      blocks.push({ selector: selector.trim(), props });
  }
  if (src.slice(last).trim()) throw new Error(`${file}: unexpected text after the last block`);
  return blocks;
}
