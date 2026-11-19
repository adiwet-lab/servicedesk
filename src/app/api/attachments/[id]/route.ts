import { getActor } from "@/server/auth/get-actor";
import { readAttachment } from "@/server/services/tickets";
import { NotFoundError } from "@/server/authz/errors";
import { AttachmentBlockedError, AttachmentScanPendingError } from "@/server/storage/malware-scan";

export const dynamic = "force-dynamic";

/** Authenticated, scope-checked attachment download. Always served as a download, never inline HTML. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const { att, data } = await readAttachment(actor, id);
    const inline = new URL(req.url).searchParams.get("inline") === "1" && /^image\/(png|jpeg)$/.test(att.mimeType);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": att.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof AttachmentScanPendingError) return new Response(e.message, { status: 409, headers: { "Retry-After": "30" } });
    if (e instanceof AttachmentBlockedError) return new Response(e.message, { status: 403 });
    throw e;
  }
}
