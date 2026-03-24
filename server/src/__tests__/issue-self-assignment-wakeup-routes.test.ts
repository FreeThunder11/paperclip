import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const AGENT_1_ID = "11111111-1111-4111-8111-111111111112";
const AGENT_2_ID = "22222222-2222-4222-8222-222222222222";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  addComment: vi.fn(),
  findMentionedAgents: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
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

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId: AGENT_1_ID,
      companyId: "company-1",
      runId: "run-1",
      companyIds: ["company-1"],
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue self-assignment wakeup routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockAgentService.getById.mockResolvedValue({
      id: AGENT_1_ID,
      companyId: "company-1",
      role: "ceo",
      permissions: {},
    });
    mockIssueService.addComment.mockResolvedValue(null);
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
  });

  it("does not enqueue a new assignment wakeup when an agent reassigns an issue to itself", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      status: "blocked",
      assigneeAgentId: AGENT_2_ID,
      assigneeUserId: null,
      identifier: "PAP-700",
      title: "Self assignment",
      projectId: null,
      createdByUserId: null,
    });
    mockIssueService.update.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: AGENT_1_ID,
      assigneeUserId: null,
      identifier: "PAP-700",
      title: "Self assignment",
      projectId: null,
      createdByUserId: null,
    });

    const res = await request(createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ assigneeAgentId: AGENT_1_ID, status: "todo" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await Promise.resolve();
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("still enqueues assignment wakeups when reassigning to another agent", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      status: "blocked",
      assigneeAgentId: AGENT_1_ID,
      assigneeUserId: null,
      identifier: "PAP-701",
      title: "Cross assignment",
      projectId: null,
      createdByUserId: null,
    });
    mockIssueService.update.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: AGENT_2_ID,
      assigneeUserId: null,
      identifier: "PAP-701",
      title: "Cross assignment",
      projectId: null,
      createdByUserId: null,
    });

    const res = await request(createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ assigneeAgentId: AGENT_2_ID, status: "todo" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await Promise.resolve();
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      AGENT_2_ID,
      expect.objectContaining({
        source: "assignment",
        reason: "issue_assigned",
        payload: { issueId: "11111111-1111-4111-8111-111111111111", mutation: "update" },
      }),
    );
  });
});
