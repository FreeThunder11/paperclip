import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  getRun: vi.fn(),
  getActiveRunForAgent: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
  getMembership: vi.fn(),
  listPrincipalGrants: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  agentInstructionsService: () => ({}),
  accessService: () => mockAccessService,
  approvalService: () => ({}),
  budgetService: () => ({}),
  companySkillService: () => ({ listRuntimeSkillEntries: vi.fn() }),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: vi.fn(),
  secretService: () => ({}),
  syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
  workspaceOperationService: () => ({}),
}));

vi.mock("../adapters/index.js", () => ({
  findServerAdapter: vi.fn(),
  listAdapterModels: vi.fn(),
}));

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => ({
    getGeneral: vi.fn(async () => ({ censorUsernameInLogs: false })),
  }),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", agentRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("agent active-run route", () => {
  const issueId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getByIdentifier.mockResolvedValue(null);
    mockHeartbeatService.getActiveRunForAgent.mockResolvedValue(null);
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      name: "Builder",
      adapterType: "codex_local",
    });
  });

  it("returns null for cancelled issues even when executionRunId points to a queued run", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: issueId,
      companyId: "company-1",
      status: "cancelled",
      assigneeAgentId: null,
      executionRunId: "run-1",
    });

    const res = await request(createApp()).get(`/api/issues/${issueId}/active-run`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toBeNull();
    expect(mockHeartbeatService.getRun).not.toHaveBeenCalled();
  });

  it("returns the active run for in-progress issues", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: issueId,
      companyId: "company-1",
      status: "in_progress",
      assigneeAgentId: "agent-1",
      executionRunId: "run-1",
    });
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      agentId: "agent-1",
      status: "queued",
      invocationSource: "assignment",
      triggerDetail: "system",
      startedAt: null,
      finishedAt: null,
      createdAt: new Date("2026-03-24T16:10:00.000Z"),
    });

    const res = await request(createApp()).get(`/api/issues/${issueId}/active-run`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: "run-1",
      agentId: "agent-1",
      agentName: "Builder",
      adapterType: "codex_local",
      status: "queued",
    });
  });
});
