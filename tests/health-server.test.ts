import assert from "node:assert/strict";
import test from "node:test";

import {
  getHealthStatus,
  startHealthServer,
  stopHealthServer,
} from "../src/health/health-server.js";

test("health is okay when Discord and PostgreSQL are ready", async () => {
  const health = await getHealthStatus({
    isDiscordReady: () => true,
    checkDatabase: async () => undefined,
  });

  assert.equal(health.status, "ok");
  assert.equal(health.discord, "ready");
  assert.equal(health.database, "ready");
});

test("health is degraded while Discord is disconnected", async () => {
  const health = await getHealthStatus({
    isDiscordReady: () => false,
    checkDatabase: async () => undefined,
  });

  assert.equal(health.status, "degraded");
  assert.equal(health.discord, "not_ready");
  assert.equal(health.database, "ready");
});

test("health is degraded when PostgreSQL is unavailable", async () => {
  const health = await getHealthStatus({
    isDiscordReady: () => true,
    checkDatabase: async () => {
      throw new Error("database unavailable");
    },
  });

  assert.equal(health.status, "degraded");
  assert.equal(health.discord, "ready");
  assert.equal(health.database, "unavailable");
});

test("health endpoint returns an HTTP readiness response", async (context) => {
  const server = await startHealthServer(0, {
    isDiscordReady: () => true,
    checkDatabase: async () => undefined,
  });
  context.after(async () => stopHealthServer(server));

  const address = server.address();
  assert.ok(address && typeof address === "object");

  const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  const body = (await response.json()) as { status?: string };

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
});
