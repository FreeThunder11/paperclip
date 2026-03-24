import * as firstModule from "../../../packages/adapter-utils/src/server-utils.ts?instance=first";
import * as secondModule from "../../../packages/adapter-utils/src/server-utils.ts?instance=second";
import { describe, expect, it } from "vitest";

describe("adapter runningProcesses singleton", () => {
  it("reuses the same process registry across module re-evaluations", () => {
    firstModule.runningProcesses.clear();
    const marker = {
      child: {} as never,
      graceSec: 5,
    };
    firstModule.runningProcesses.set("run-reload-test", marker);

    expect(secondModule.runningProcesses).toBe(firstModule.runningProcesses);
    expect(secondModule.runningProcesses.get("run-reload-test")).toBe(marker);

    firstModule.runningProcesses.clear();
  });
});
