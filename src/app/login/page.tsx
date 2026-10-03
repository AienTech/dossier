import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/** Password-only sign-in, outside the app shell (PRD AUTH-1, AUTH-8). */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-[400px] flex-col gap-8">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <div className="font-serif text-[30px] font-medium tracking-[-0.01em]">Dossier</div>
          <div className="text-sm text-muted">Your job search, on your server</div>
        </div>
        <LoginForm next={typeof next === "string" ? next : undefined} />
        <p className="text-center text-meta leading-[1.6] text-pretty text-muted">
          Your password is set on the server with{" "}
          <code className="font-mono text-label">DOSSIER_PASSWORD</code>. Forgot it? Check your{" "}
          <code className="font-mono text-label">.env</code> file.
        </p>
      </div>
    </main>
  );
}
