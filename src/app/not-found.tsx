import Link from "next/link";
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-5xl font-bold text-muted-foreground">404</p>
      <p className="font-medium">This page does not exist or you do not have access to it.</p>
      <Link href="/dashboard" className="text-sm text-primary hover:underline">Back to dashboard</Link>
    </div>
  );
}
