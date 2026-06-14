/**
 * Phase 5: tests for the updaterHealthCheck IPC
 * wrapper. Mocks `@tauri-apps/api/core`'s `invoke`
 * to assert the wire shape and the returned
 * payload's TS type matches the discriminated
 * union.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { updaterHealthCheck, type UpdaterHealth } from "./updaterHealth";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("updaterHealthCheck (Phase 5)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the 'updater_health_check' Tauri command", async () => {
    invokeMock.mockResolvedValue({ kind: "reachable", status: 200 });

    await updaterHealthCheck();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("updater_health_check");
  });

  it("returns a Reachable payload when the Rust side reports status 200", async () => {
    const payload: UpdaterHealth = { kind: "reachable", status: 200 };
    invokeMock.mockResolvedValue(payload);

    const result = await updaterHealthCheck();

    expect(result).toEqual(payload);
    if (result.kind === "reachable") {
      expect(result.status).toBe(200);
    }
  });

  it("returns an Unreachable payload when the Rust side reports a network error", async () => {
    const payload: UpdaterHealth = {
      kind: "unreachable",
      reason: "timeout after 5s",
    };
    invokeMock.mockResolvedValue(payload);

    const result = await updaterHealthCheck();

    expect(result).toEqual(payload);
    if (result.kind === "unreachable") {
      expect(result.reason).toBe("timeout after 5s");
    }
  });

  it("propagates Rust-side errors via Tauri invoke rejection", async () => {
    invokeMock.mockRejectedValue(new Error("IPC channel closed"));

    await expect(updaterHealthCheck()).rejects.toThrow("IPC channel closed");
  });
});
