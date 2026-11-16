import {beforeEach, describe, expect, it, vi} from "vitest";
import {NextRequest} from "next/server";
const fake=vi.hoisted(()=>({session: false, approval:vi.fn(),application:vi.fn(),file:vi.fn()}));
vi.mock("@/lib/auth/session",()=>({getSession:vi.fn(async()=>fake.session?{persistent:false,issuedAt:new Date(),expiresAt:new Date(Date.now()+60000)}:null)}));
vi.mock("@/lib/prisma",()=>({prisma:{connectorApproval:{findUnique:fake.approval},application:{findUnique:fake.application}}}));
vi.mock("@/lib/stored-files",()=>({readStoredFile:fake.file}));
import {GET as approvalFile} from "@/app/api/delegation-files/[approvalId]/[key]/route";
import {GET as submittedFile} from "@/app/api/submission-files/[applicationId]/[key]/route";
beforeEach(()=>{fake.session=false;vi.clearAllMocks();fake.approval.mockResolvedValue({payload:{files:[{key:"frozen.pdf",filename:"review.pdf",contentType:"application/pdf"}]}});fake.application.mockResolvedValue({submission:{documents:[{file_key:"frozen.pdf",filename:"actual.pdf",content_type:"application/pdf"}]}});fake.file.mockResolvedValue(new TextEncoder().encode("%PDF-private"));});
for(const [name,handler,params] of [
  ["approval attachment",approvalFile,{approvalId:"review",key:"frozen.pdf"}],
  ["submitted original",submittedFile,{applicationId:"application",key:"frozen.pdf"}],
] as const){
 describe(name,()=>{
  it("refuses anonymous and MCP bearer-only requests before reading any records or bytes",async()=>{
   const request=new NextRequest("https://hireme.example/api/files",{headers:{Authorization:"Bearer mcp-token"}});
   const response=await handler(request,{params:Promise.resolve(params)} as never);
   expect(response.status).toBe(401);expect(fake.approval).not.toHaveBeenCalled();expect(fake.application).not.toHaveBeenCalled();expect(fake.file).not.toHaveBeenCalled();
  });
  it("allows an owner only the file referenced by that record, with private no-store headers",async()=>{
   fake.session=true;
   const request=new NextRequest("https://hireme.example/api/files");
   const missing=await handler(request,{params:Promise.resolve({...params,key:"other.pdf"})} as never);
   expect(missing.status).toBe(404);expect(fake.file).not.toHaveBeenCalled();
   const response=await handler(request,{params:Promise.resolve(params)} as never);
   expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("content-disposition")).toMatch(/^attachment/);expect(await response.text()).toBe("%PDF-private");
  });
  it("refuses cross-origin access even with an owner session",async()=>{
   fake.session=true;
   const request=new NextRequest("https://hireme.example/api/files",{headers:{Origin:"https://evil.example","sec-fetch-site":"cross-site"}});
   const response=await handler(request,{params:Promise.resolve(params)} as never);
   expect(response.status).toBe(403);expect(fake.file).not.toHaveBeenCalled();
  });
 });
}
