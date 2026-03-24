import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const ISSUE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_1_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_2_ID = "33333333-3333-4333-8333-333333333333";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  release: vi.fn(),
  addComment: vi.fn(),
  findMentionedAgents: vi.fn(),
  assertCheckoutOwner: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  cancelIssueRuns: vi.fn(async () => 0),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  documentService: () => ({}),
  executionWorkspaceService: () => ({}),
  goalService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectService: () => ({ getById: vi.fn(async () => null) }),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({}),
}));

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue execution cleanup routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.addComment.mockResolvedValue(null);
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });
    mockAgentService.getById.mockResolvedValue({
      id: AGENT_1_ID,
      companyId: "company-1",
      role: "ceo",
      permissions: {},
    });
  });

  it("cancels stale issue-bound runs when a board update clears execution ownership", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: ISSUE_ID,
      companyId: "company-1",
      status: "in_progress",
      assigneeAgentId: AGENT_1_ID,
      assigneeUserId: null,
      createdByUserId: null,
      identifier: "PAP-710",
      title: "Reassign issue",
      projectId: null,
    });
    mockIssueService.update.mockResolvedValue({
      id: ISSUE_ID,
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: AGENT_2_ID,
      assigneeUserId: null,
      createdByUserId: null,
      identifier: "PAP-710",
      title: "Reassign issue",
      projectId: null,
      executionRunId: null,
      checkoutRunId: null,
    });

    const app = createApp({
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .patch(`/api/issues/${ISSUE_ID}`)
      .send({ assigneeAgentId: AGENT_2_ID, status: "todo" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.cancelIssueRuns).toHaveBeenCalledWith(ISSUE_ID, {
      reason: "Cancelled because issue execution was cleared by issue update",
    });
  });

  it("keeps the current agent run alive while cancelling sibling issue runs on release", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: ISSUE_ID,
      companyId: "company-1",
      status: "in_progress",
      assigneeAgentId: AGENT_1_ID,
      assigneeUserId: null,
      createdByUserId: null,
      identifier: "PAP-711",
      title: "Release issue",
      projectId: null,
    });
    mockIssueService.release.mockResolvedValue({
      id: ISSUE_ID,
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: null,
      assigneeUserId: null,
      createdByUserId: null,
      identifier: "PAP-711",
      title: "Release issue",
      projectId: null,
      executionRunId: null,
      checkoutRunId: null,
    });

    const app = createApp({
      type: "agent",
      agentId: AGENT_1_ID,
      companyId: "company-1",
      companyIds: ["company-1"],
      runId: "run-self",
      source: "local",
    });

    const res = await request(app).post(`/api/issues/${ISSUE_ID}/release`).send({});

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.cancelIssueRuns).toHaveBeenCalledWith(ISSUE_ID, {
      excludeRunId: "run-self",
      reason: "Cancelled because issue was released",
    });
  });
});
