/** The Docker image pnpm verify and pnpm render run rofi in. */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./colors.ts";

/** Builds (or reuses) the image with the given Ubuntu release's rofi. */
export function image(release: string): string {
  const tag = `mistpine-rofi:${release}`;
  execFileSync(
    "docker",
    [
      "build",
      "-q",
      "--build-arg",
      `BASE=ubuntu:${release}`,
      "-t",
      tag,
      "-f",
      join(ROOT, "scripts", "render", "Dockerfile"),
      join(ROOT, "scripts", "render"),
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return tag;
}
