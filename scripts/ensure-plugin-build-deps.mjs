#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const tscInvocation = resolveTypeScriptInvocation();

const buildTargets = [
  {
    name: "@paperclipai/shared",
    output: path.join(rootDir, "packages/shared/dist/index.js"),
    tsconfig: path.join(rootDir, "packages/shared/tsconfig.json"),
  },
  {
    name: "@paperclipai/plugin-sdk",
    output: path.join(rootDir, "packages/plugins/sdk/dist/index.js"),
    tsconfig: path.join(rootDir, "packages/plugins/sdk/tsconfig.json"),
  },
];

for (const target of buildTargets) {
  if (fs.existsSync(target.output)) {
    continue;
  }

  const result = spawnSync(tscInvocation.command, [...tscInvocation.args, "-p", target.tsconfig], {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveTypeScriptInvocation() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return {
      command: process.execPath,
      args: [npmExecPath, "exec", "tsc"],
    };
  }

  const binCandidates = [
    path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc"),
    path.join(rootDir, "node_modules", "typescript", "bin", "tsc"),
    path.join(rootDir, "node_modules", "typescript", "lib", "tsc.js"),
  ];

  for (const candidate of binCandidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    if (candidate.endsWith(".js")) {
      return {
        command: process.execPath,
        args: [candidate],
      };
    }

    return {
      command: candidate,
      args: [],
    };
  }

  throw new Error(
    `TypeScript CLI not found via npm_execpath=${npmExecPath ?? "<unset>"} or node_modules/.bin/typescript fallbacks`,
  );
}
