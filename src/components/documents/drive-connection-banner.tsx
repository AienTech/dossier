"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function DriveConnectionBanner({ message, suppressOnJob = false }: { message: string | null; suppressOnJob?: boolean }) {
  const pathname = usePathname();
  if (!message || (suppressOnJob && /^\/applications\/[^/]+$/.test(pathname))) return null;
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 bg-red-700 px-6 py-3 text-sm text-white">
    <p><strong>Google Drive needs attention.</strong> {message} ZIP downloads remain available.</p>
    <Link href="/settings?section=google" className="font-medium text-white underline">Fix Google connection</Link>
  </div>;
}
