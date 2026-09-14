export type HealthStatus = "ok" | "degraded";

export interface HealthReport {
  status: HealthStatus;
  database: "connected" | "error";
  timestamp: string;
}
