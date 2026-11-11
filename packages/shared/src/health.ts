import type { HealthStatus, ServiceState } from './enums.js';

export interface HealthResponse {
  status: HealthStatus;
  database: ServiceState;
}

export interface ApiInfo {
  name: string;
  version: string;
}
