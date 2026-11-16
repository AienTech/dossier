import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createTestClient,resetDatabase} from "@/test/db";
const db=vi.hoisted(()=>({client:undefined as ReturnType<typeof createTestClient>|undefined}));
vi.mock("@/lib/prisma",async()=>{const {createTestClient}=await import("@/test/db");db.client=createTestClient();return{prisma:db.client};});
vi.mock("pg",async importOriginal=>({...await importOriginal<typeof import("pg")>(),Client:class{async connect(){} on(){} async query(){return{rows:[{acquired:true}]};}}}));
vi.mock("@/lib/jobs/runner",()=>({pollDatabaseQueue:vi.fn(async()=>{})}));
vi.mock("@/lib/google/sync",()=>({inboxCheckRunning:()=>false}));
vi.mock("@/lib/worker-scaling",()=>({workerWindowOpen:()=>true,reconcileCloudWorker:vi.fn()}));
import {acquireWorkerLeadership,startCloudQueue} from "./cloud-worker";
import {pollDatabaseQueue} from "@/lib/jobs/runner";
beforeEach(async()=>{await resetDatabase(db.client!);vi.stubEnv("DATABASE_URL_UNPOOLED","postgresql://test:test@localhost/hireme_test");vi.useFakeTimers();});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllEnvs();});
afterAll(async()=>db.client!.$disconnect());
describe("worker heartbeat against the real schema",()=>{
 it("writes the required Setting timestamp and starts consuming jobs",async()=>{
  await acquireWorkerLeadership();startCloudQueue();
  await vi.waitFor(()=>expect(pollDatabaseQueue).toHaveBeenCalled());
  const setting=await db.client!.setting.findUniqueOrThrow({where:{key:"workerHeartbeat"}});
  expect(Number.isFinite(Date.parse(setting.value))).toBe(true);expect(setting.updatedAt).toBeInstanceOf(Date);
 });
});
