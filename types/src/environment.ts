export interface Environment {
  projectId: string;
  label: string;
  version: number;
  isActive: boolean;
  createdAt: number;
  createdBy: string;
  changeSummary?: string;
  variableCount: number;
}

export interface EnvironmentVersion {
  version: number;
  createdAt: number;
  createdBy: string;
  changeSummary?: string;
  variableCount: number;
  isActive: boolean;
}
