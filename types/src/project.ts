export type UserPlan = "free" | "pro" | "team" | "enterprise";

export interface User {
  clerkId: string;
  email: string;
  name?: string;
  createdAt: number;
  plan: UserPlan;
}

export interface Project {
  name: string;
  slug: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  isArchived: boolean;
  description?: string;
}

export type ProjectMemberRole = "admin" | "member" | "viewer";

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  addedAt: number;
  addedBy: string;
}
