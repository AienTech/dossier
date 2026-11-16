import { z } from "zod";
const text = (n: number) => z.string().max(n);
export const submissionSnapshot = z.object({
  source: z.enum(["manual", "bot"]), bot: text(100).optional(), confirmed: z.boolean(), submitted_at: z.iso.datetime().optional(), confirmation_reference: text(1000).optional(), confirmation_url: z.url({ protocol: /^https?$/ }).max(2000).optional(),
  recruiter: z.object({ name: text(200).optional(), email: text(320).optional(), phone: text(60).optional() }).optional(),
  documents: z.array(z.object({ kind: z.enum(["resume", "cover_letter", "email"]), text: text(100000), filename: text(200).optional(), original_base64: z.string().max(3000000).optional(), file_key: z.string().regex(/^[a-zA-Z0-9_.-]+$/).optional(), content_type: text(200).optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(3).optional(),
});
