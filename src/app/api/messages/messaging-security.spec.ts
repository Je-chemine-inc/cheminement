/**
 * Security + routing guards for internal messaging.
 *
 * Compose (POST /api/messages): blocks messaging a recipient outside the
 * sender's allowed set (403). Thread (GET / POST /api/messages/[conversationId]):
 * a non-participant can neither read nor reply (404, via the participant-scoped
 * findOne). A participant routes through to read/reply.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ME = "a1a1a1a1a1a1a1a1a1a1a1a1";
const OTHER = "b2b2b2b2b2b2b2b2b2b2b2b2";
const CONV = "c3c3c3c3c3c3c3c3c3c3c3c3";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const convFindOne = vi.fn();
  const convCreate = vi.fn().mockResolvedValue({ _id: "conv1" });
  const convUpdateOne = vi.fn().mockResolvedValue({});
  const msgFind = vi.fn();
  const msgCreate = vi.fn().mockResolvedValue({ _id: "m1" });
  const msgUpdateMany = vi.fn().mockResolvedValue({});
  const userFindById = vi.fn();
  const userFind = vi.fn();
  const getAllowedRecipientIds = vi.fn();
  const store: { conv: Record<string, unknown> | null } = { conv: null };
  return {
    getServerSession,
    convFindOne,
    convCreate,
    convUpdateOne,
    msgFind,
    msgCreate,
    msgUpdateMany,
    userFindById,
    userFind,
    getAllowedRecipientIds,
    store,
  };
});

const makeQuery = (result: unknown) => ({
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  select() {
    return this;
  },
  lean() {
    return Promise.resolve(result);
  },
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
    return Promise.resolve(result).then(res, rej);
  },
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/models/Conversation", () => ({
  default: {
    find: () => makeQuery([]),
    findOne: (...a: unknown[]) => h.convFindOne(...a),
    create: h.convCreate,
    updateOne: h.convUpdateOne,
  },
}));
vi.mock("@/models/Message", () => ({
  default: {
    find: (...a: unknown[]) => h.msgFind(...a),
    create: h.msgCreate,
    updateMany: h.msgUpdateMany,
  },
}));
vi.mock("@/models/User", () => ({
  default: {
    findById: (...a: unknown[]) => h.userFindById(...a),
    find: (...a: unknown[]) => h.userFind(...a),
  },
}));
vi.mock("@/lib/messaging-permissions", () => ({
  SUPPORT_RECIPIENT_ID: "support",
  getActiveAdminIds: vi.fn().mockResolvedValue([]),
  getAllowedRecipientIds: (...a: unknown[]) => h.getAllowedRecipientIds(...a),
  getClientPrimaryProfessionalId: vi.fn().mockResolvedValue(null),
  getHiddenProfessionalIds: vi.fn().mockResolvedValue(new Set()),
}));

import { POST as composePOST } from "@/app/api/messages/route";
import {
  GET as threadGET,
  POST as threadPOST,
} from "@/app/api/messages/[conversationId]/route";

type Res = Promise<{ status: number; body: Record<string, unknown> }>;
const session = (role: string, id = ME) => ({ user: { id, role } });

beforeEach(() => {
  vi.clearAllMocks();
  h.store.conv = null;
  h.convFindOne.mockImplementation(() => makeQuery(h.store.conv));
  h.msgFind.mockImplementation(() => makeQuery([]));
  h.userFindById.mockImplementation(() => makeQuery({ _id: OTHER }));
  h.userFind.mockImplementation(() => makeQuery([]));
  h.getAllowedRecipientIds.mockResolvedValue(new Set<string>());
});

const composeCall = (body: unknown, sess: unknown = session("client")): Res => {
  h.getServerSession.mockResolvedValueOnce(sess);
  return composePOST({ json: async () => body } as never) as unknown as Res;
};
const threadGetCall = (sess: unknown = session("client")): Res => {
  h.getServerSession.mockResolvedValueOnce(sess);
  return threadGET({} as never, {
    params: Promise.resolve({ conversationId: CONV }),
  }) as unknown as Res;
};
const threadPostCall = (body: unknown, sess: unknown = session("client")): Res => {
  h.getServerSession.mockResolvedValueOnce(sess);
  return threadPOST({ json: async () => body } as never, {
    params: Promise.resolve({ conversationId: CONV }),
  }) as unknown as Res;
};

describe("compose POST /api/messages — permission gate", () => {
  it("401 when unauthenticated", async () => {
    const res = await composeCall({ recipientId: OTHER, subject: "s", message: "m" }, null);
    expect(res.status).toBe(401);
  });

  it("400 on missing fields", async () => {
    const res = await composeCall({ recipientId: OTHER });
    expect(res.status).toBe(400);
  });

  it("403 when the recipient is NOT in the allowed set", async () => {
    h.getAllowedRecipientIds.mockResolvedValue(new Set<string>()); // none allowed
    const res = await composeCall({ recipientId: OTHER, subject: "s", message: "m" });
    expect(res.status).toBe(403);
    expect(h.convCreate).not.toHaveBeenCalled();
  });

  it("creates the conversation when the recipient IS allowed (201)", async () => {
    h.getAllowedRecipientIds.mockResolvedValue(new Set<string>([OTHER]));
    const res = await composeCall({ recipientId: OTHER, subject: "s", message: "m" });
    expect(res.status).toBe(201);
    expect(h.convCreate).toHaveBeenCalledTimes(1);
    expect(h.msgCreate).toHaveBeenCalledTimes(1);
  });
});

describe("thread /api/messages/[conversationId] — participant guard", () => {
  it("GET 404 for a non-participant (no matching conversation)", async () => {
    h.store.conv = null;
    const res = await threadGetCall();
    expect(res.status).toBe(404);
    // The lookup is scoped to the requester as a participant.
    expect(h.convFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: CONV, participants: expect.anything() }),
    );
  });

  it("POST reply 404 for a non-participant", async () => {
    h.store.conv = null;
    const res = await threadPostCall({ message: "hi" });
    expect(res.status).toBe(404);
    expect(h.msgCreate).not.toHaveBeenCalled();
  });

  it("POST reply 201 for a participant", async () => {
    h.store.conv = {
      _id: CONV,
      participants: [{ toString: () => ME }, { toString: () => OTHER }],
      unreadCounts: new Map<string, number>(),
    };
    const res = await threadPostCall({ message: "hi" });
    expect(res.status).toBe(201);
    expect(h.msgCreate).toHaveBeenCalledTimes(1);
    expect(h.convUpdateOne).toHaveBeenCalledTimes(1);
  });
});
