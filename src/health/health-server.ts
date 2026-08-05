import { createServer, type Server } from "node:http";

export interface HealthDependencies {
  isDiscordReady: () => boolean;
  checkDatabase: () => Promise<void>;
}

export interface HealthStatus {
  status: "ok" | "degraded";
  discord: "ready" | "not_ready";
  database: "ready" | "unavailable";
  checkedAt: string;
}

export async function getHealthStatus(
  dependencies: HealthDependencies,
): Promise<HealthStatus> {
  const discord = dependencies.isDiscordReady() ? "ready" : "not_ready";
  let database: HealthStatus["database"] = "ready";

  try {
    await dependencies.checkDatabase();
  } catch {
    database = "unavailable";
  }

  return {
    status: discord === "ready" && database === "ready" ? "ok" : "degraded",
    discord,
    database,
    checkedAt: new Date().toISOString(),
  };
}

export function createHealthServer(
  dependencies: HealthDependencies,
): Server {
  return createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/healthz") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    void getHealthStatus(dependencies)
      .then((health) => {
        response.writeHead(health.status === "ok" ? 200 : 503, {
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify(health));
      })
      .catch((error: unknown) => {
        console.error("Health check failed unexpectedly:", error);
        response.writeHead(503, {
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify({ status: "degraded" }));
      });
  });
}

export async function startHealthServer(
  port: number,
  dependencies: HealthDependencies,
): Promise<Server> {
  const server = createHealthServer(dependencies);

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => reject(error);
    server.once("error", handleError);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", handleError);
      resolve();
    });
  });

  console.log(`Health endpoint listening on port ${port}.`);
  return server;
}

export async function stopHealthServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
