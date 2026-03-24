import { logger } from "../middleware/logger.js";

type WakeupTriggerDetail = "manual" | "ping" | "callback" | "system";
type WakeupSource = "timer" | "assignment" | "on_demand" | "automation";
type AssignmentWakeActorType = "user" | "agent" | "system";

export function shouldWakeAssigneeOnAssignment(input: {
  actorType?: AssignmentWakeActorType;
  actorAgentId?: string | null;
  actorRunId?: string | null;
  assigneeAgentId: string | null;
  status: string;
}) {
  if (!input.assigneeAgentId || input.status === "backlog") return false;
  if ((input.actorType ?? "system") !== "agent") return true;
  if (!input.actorAgentId || !input.actorRunId) return true;
  return input.actorAgentId !== input.assigneeAgentId;
}

export interface IssueAssignmentWakeupDeps {
  wakeup: (
    agentId: string,
    opts: {
      source?: WakeupSource;
      triggerDetail?: WakeupTriggerDetail;
      reason?: string | null;
      payload?: Record<string, unknown> | null;
      requestedByActorType?: "user" | "agent" | "system";
      requestedByActorId?: string | null;
      contextSnapshot?: Record<string, unknown>;
    },
  ) => Promise<unknown>;
}

export function queueIssueAssignmentWakeup(input: {
  heartbeat: IssueAssignmentWakeupDeps;
  issue: { id: string; assigneeAgentId: string | null; status: string };
  reason: string;
  mutation: string;
  contextSource: string;
  requestedByActorType?: "user" | "agent" | "system";
  requestedByActorId?: string | null;
  requestedByRunId?: string | null;
  rethrowOnError?: boolean;
}) {
  const actorType = input.requestedByActorType ?? "system";
  const actorAgentId = actorType === "agent" ? input.requestedByActorId ?? null : null;
  const actorRunId = input.requestedByRunId ?? null;
  const assigneeAgentId = input.issue.assigneeAgentId;
  if (
    !shouldWakeAssigneeOnAssignment({
      actorType,
      actorAgentId,
      actorRunId,
      assigneeAgentId,
      status: input.issue.status,
    })
  ) {
    return;
  }

  if (!assigneeAgentId) {
    return;
  }

  return input.heartbeat
    .wakeup(assigneeAgentId, {
      source: "assignment",
      triggerDetail: "system",
      reason: input.reason,
      payload: { issueId: input.issue.id, mutation: input.mutation },
      requestedByActorType: input.requestedByActorType,
      requestedByActorId: input.requestedByActorId ?? null,
      contextSnapshot: { issueId: input.issue.id, source: input.contextSource },
    })
    .catch((err) => {
      logger.warn({ err, issueId: input.issue.id }, "failed to wake assignee on issue assignment");
      if (input.rethrowOnError) throw err;
      return null;
    });
}
