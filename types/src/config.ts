/** Local project config stored in .slickenv (committed to git) */
export interface SlickEnvConfig {
  version: number;
  projectId: string;
  projectName: string;
  defaultEnvironment: string;
  apiUrl: string;
  lastSyncedVersion?: number;
}

/** Global CLI config stored in ~/.slickenv/config.json */
export interface GlobalConfig {
  apiUrl?: string;
}
