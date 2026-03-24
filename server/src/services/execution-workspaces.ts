import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { executionWorkspaces, issues, projects, projectWorkspaces } from "@paperclipai/db";
import type { ExecutionWorkspace } from "@paperclipai/shared";
import { parseProjectExecutionWorkspacePolicy } from "./execution-workspace-policy.js";
import { workspaceOperationService } from "./workspace-operations.js";
import {
  cleanupExecutionWorkspaceArtifacts,
  stopRuntimeServicesForExecutionWorkspace,
} from "./workspace-runtime.js";

type ExecutionWorkspaceRow = typeof executionWorkspaces.$inferSelect;
type LinkedIssueRef = {
  id: string;
  status: string;
};

const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);

function toExecutionWorkspace(row: ExecutionWorkspaceRow): ExecutionWorkspace {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId,
    projectWorkspaceId: row.projectWorkspaceId ?? null,
    sourceIssueId: row.sourceIssueId ?? null,
    mode: row.mode as ExecutionWorkspace["mode"],
    strategyType: row.strategyType as ExecutionWorkspace["strategyType"],
    name: row.name,
    status: row.status as ExecutionWorkspace["status"],
    cwd: row.cwd ?? null,
    repoUrl: row.repoUrl ?? null,
    baseRef: row.baseRef ?? null,
    branchName: row.branchName ?? null,
    providerType: row.providerType as ExecutionWorkspace["providerType"],
    providerRef: row.providerRef ?? null,
    derivedFromExecutionWorkspaceId: row.derivedFromExecutionWorkspaceId ?? null,
    lastUsedAt: row.lastUsedAt,
    openedAt: row.openedAt,
    closedAt: row.closedAt ?? null,
    cleanupEligibleAt: row.cleanupEligibleAt ?? null,
    cleanupReason: row.cleanupReason ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function executionWorkspaceService(db: Db) {
  const workspaceOperationsSvc = workspaceOperationService(db);

  return {
    list: async (companyId: string, filters?: {
      projectId?: string;
      projectWorkspaceId?: string;
      issueId?: string;
      status?: string;
      reuseEligible?: boolean;
    }) => {
      const conditions = [eq(executionWorkspaces.companyId, companyId)];
      if (filters?.projectId) conditions.push(eq(executionWorkspaces.projectId, filters.projectId));
      if (filters?.projectWorkspaceId) {
        conditions.push(eq(executionWorkspaces.projectWorkspaceId, filters.projectWorkspaceId));
      }
      if (filters?.issueId) conditions.push(eq(executionWorkspaces.sourceIssueId, filters.issueId));
      if (filters?.status) {
        const statuses = filters.status.split(",").map((value) => value.trim()).filter(Boolean);
        if (statuses.length === 1) conditions.push(eq(executionWorkspaces.status, statuses[0]!));
        else if (statuses.length > 1) conditions.push(inArray(executionWorkspaces.status, statuses));
      }
      if (filters?.reuseEligible) {
        conditions.push(inArray(executionWorkspaces.status, ["active", "idle", "in_review"]));
      }

      const rows = await db
        .select()
        .from(executionWorkspaces)
        .where(and(...conditions))
        .orderBy(desc(executionWorkspaces.lastUsedAt), desc(executionWorkspaces.createdAt));
      return rows.map(toExecutionWorkspace);
    },

    getById: async (id: string) => {
      const row = await db
        .select()
        .from(executionWorkspaces)
        .where(eq(executionWorkspaces.id, id))
        .then((rows) => rows[0] ?? null);
      return row ? toExecutionWorkspace(row) : null;
    },

    create: async (data: typeof executionWorkspaces.$inferInsert) => {
      const row = await db
        .insert(executionWorkspaces)
        .values(data)
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? toExecutionWorkspace(row) : null;
    },

    update: async (id: string, patch: Partial<typeof executionWorkspaces.$inferInsert>) => {
      const row = await db
        .update(executionWorkspaces)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(executionWorkspaces.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? toExecutionWorkspace(row) : null;
    },

    archiveWithCleanup: async (
      existing: ExecutionWorkspace,
      patch: Partial<typeof executionWorkspaces.$inferInsert> = {},
    ): Promise<{
      workspace: ExecutionWorkspace | null;
      cleanupWarnings: string[];
      blockedByActiveIssues: LinkedIssueRef[];
      cleaned: boolean | null;
    }> => {
      const linkedIssues = await db
        .select({
          id: issues.id,
          status: issues.status,
        })
        .from(issues)
        .where(and(eq(issues.companyId, existing.companyId), eq(issues.executionWorkspaceId, existing.id)));
      const blockedByActiveIssues = linkedIssues.filter((issue) => !TERMINAL_ISSUE_STATUSES.has(issue.status));

      if (blockedByActiveIssues.length > 0) {
        return {
          workspace: existing,
          cleanupWarnings: [],
          blockedByActiveIssues,
          cleaned: null,
        };
      }

      const closedAt = new Date();
      const archivedWorkspace = await db
        .update(executionWorkspaces)
        .set({
          ...patch,
          status: "archived",
          closedAt,
          cleanupReason: null,
          updatedAt: closedAt,
        })
        .where(eq(executionWorkspaces.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? null);

      if (!archivedWorkspace) {
        return {
          workspace: null,
          cleanupWarnings: [],
          blockedByActiveIssues: [],
          cleaned: null,
        };
      }

      let workspace = toExecutionWorkspace(archivedWorkspace);

      try {
        await stopRuntimeServicesForExecutionWorkspace({
          db,
          executionWorkspaceId: existing.id,
          workspaceCwd: existing.cwd,
        });

        const projectWorkspace = existing.projectWorkspaceId
          ? await db
              .select({
                cwd: projectWorkspaces.cwd,
                cleanupCommand: projectWorkspaces.cleanupCommand,
              })
              .from(projectWorkspaces)
              .where(
                and(
                  eq(projectWorkspaces.id, existing.projectWorkspaceId),
                  eq(projectWorkspaces.companyId, existing.companyId),
                ),
              )
              .then((rows) => rows[0] ?? null)
          : null;

        const projectPolicy = existing.projectId
          ? await db
              .select({
                executionWorkspacePolicy: projects.executionWorkspacePolicy,
              })
              .from(projects)
              .where(and(eq(projects.id, existing.projectId), eq(projects.companyId, existing.companyId)))
              .then((rows) => parseProjectExecutionWorkspacePolicy(rows[0]?.executionWorkspacePolicy))
          : null;

        const cleanupResult = await cleanupExecutionWorkspaceArtifacts({
          workspace: existing,
          projectWorkspace,
          teardownCommand: projectPolicy?.workspaceStrategy?.teardownCommand ?? null,
          recorder: workspaceOperationsSvc.createRecorder({
            companyId: existing.companyId,
            executionWorkspaceId: existing.id,
          }),
        });

        const cleanupPatch: Partial<typeof executionWorkspaces.$inferInsert> = {
          closedAt,
          cleanupReason: cleanupResult.warnings.length > 0 ? cleanupResult.warnings.join(" | ") : null,
        };
        if (!cleanupResult.cleaned) {
          cleanupPatch.status = "cleanup_failed";
        }
        if (cleanupResult.warnings.length > 0 || !cleanupResult.cleaned) {
          workspace = (await db
            .update(executionWorkspaces)
            .set({
              ...cleanupPatch,
              updatedAt: new Date(),
            })
            .where(eq(executionWorkspaces.id, existing.id))
            .returning()
            .then((rows) => rows[0] ?? null)
            .then((row) => (row ? toExecutionWorkspace(row) : workspace))) ?? workspace;
        }

        return {
          workspace,
          cleanupWarnings: cleanupResult.warnings,
          blockedByActiveIssues: [],
          cleaned: cleanupResult.cleaned,
        };
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : String(error);
        workspace =
          (await db
            .update(executionWorkspaces)
            .set({
              status: "cleanup_failed",
              closedAt,
              cleanupReason: failureReason,
              updatedAt: new Date(),
            })
            .where(eq(executionWorkspaces.id, existing.id))
            .returning()
            .then((rows) => rows[0] ?? null)
            .then((row) => (row ? toExecutionWorkspace(row) : workspace))) ?? workspace;
        throw new Error(`Failed to archive execution workspace: ${failureReason}`);
      }
    },
  };
}

export { toExecutionWorkspace };
