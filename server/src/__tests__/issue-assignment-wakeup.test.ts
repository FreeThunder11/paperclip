import { describe, expect, it, vi } from "vitest";
import {
  queueIssueAssignmentWakeup,
  shouldWakeAssigneeOnAssignment,
} from "../services/issue-assignment-wakeup.js";

describe("shouldWakeAssigneeOnAssignment", () => {
  it("skips wakeups for backlog issues and missing assignees", () => {
    expect(
      shouldWakeAssigneeOnAssignment({
        actorType: "user",
        assigneeAgentId: null,
        status: "todo",
      }),
    ).toBe(false);
    expect(
      shouldWakeAssigneeOnAssignment({
        actorType: "user",
        assigneeAgentId: "agent-1",
        status: "backlog",
      }),
    ).toBe(false);
  });

  it("skips self-assignment wakeups from an active agent run", () => {
    expect(
      shouldWakeAssigneeOnAssignment({
        actorType: "agent",
        actorAgentId: "agent-1",
        actorRunId: "run-1",
        assigneeAgentId: "agent-1",
        status: "todo",
      }),
    ).toBe(false);
  });

  it("keeps wakeups for board/system actors and missing agent run ids", () => {
    expect(
      shouldWakeAssigneeOnAssignment({
        actorType: "user",
        assigneeAgentId: "agent-1",
        status: "todo",
      }),
    ).toBe(true);
    expect(
      shouldWakeAssigneeOnAssignment({
        actorType: "agent",
        actorAgentId: "agent-1",
        actorRunId: null,
        assigneeAgentId: "agent-1",
        status: "todo",
      }),
    ).toBe(true);
  });
});

describe("queueIssueAssignmentWakeup", () => {
  it("does not enqueue a second assignment wakeup for self-assignment inside an active run", async () => {
    const wakeup = vi.fn(async () => undefined);

    await queueIssueAssignmentWakeup({
      heartbeat: { wakeup },
      issue: { id: "issue-1", assigneeAgentId: "agent-1", status: "todo" },
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "issue.create",
      requestedByActorType: "agent",
      requestedByActorId: "agent-1",
      requestedByRunId: "run-1",
    });

    expect(wakeup).not.toHaveBeenCalled();
  });

  it("still enqueues assignment wakeups for other actors", async () => {
    const wakeup = vi.fn(async () => undefined);

    await queueIssueAssignmentWakeup({
      heartbeat: { wakeup },
      issue: { id: "issue-1", assigneeAgentId: "agent-1", status: "todo" },
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "issue.create",
      requestedByActorType: "user",
      requestedByActorId: "local-board",
    });

    expect(wakeup).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        source: "assignment",
        reason: "issue_assigned",
        payload: { issueId: "issue-1", mutation: "create" },
      }),
    );
  });
});
