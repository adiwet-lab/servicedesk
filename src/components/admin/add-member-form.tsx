"use client";
import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { addMemberAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";

export function AddMemberForm({ teamId, candidates }: { teamId: string; candidates: { id: string; displayName: string; email: string }[] }) {
  const [state, action, pending] = useActionState(addMemberAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="teamId" value={teamId} />
      <NativeSelect name="userId" required className="min-w-72 flex-1" aria-label="User">
        <option value="">Select user…</option>
        {candidates.map((c) => <option key={c.id} value={c.id}>{c.displayName} ({c.email})</option>)}
      </NativeSelect>
      <NativeSelect name="role" className="w-32" aria-label="Team role"><option value="MEMBER">Member</option><option value="LEAD">Lead</option></NativeSelect>
      <Button type="submit" disabled={pending}><UserPlus /> Add</Button>
      {state && !state.ok && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
