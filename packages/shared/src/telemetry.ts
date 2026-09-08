export type SeriesPoint = {
  at: number;
  latency: number | null;
  total: number;
  success: number;
};
export type ProjectTelemetry = {
  total: number;
  success: number;
  failure: number;
  availability: number | null;
  average: number | null;
  p95: number | null;
  p99: number | null;
  maxOutage: number | null;
  series: SeriesPoint[];
};
export type Telemetry = {
  at: number;
  from: number;
  projects: Record<number, ProjectTelemetry>;
  alertsToday: number;
  checks: number;
  success: number;
  series: SeriesPoint[];
};
export type ConsoleEvent = {
  id: string;
  at: number;
  level: "ok" | "warn" | "error" | "info";
  text: string;
};
