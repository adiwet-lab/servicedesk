"use client";
import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { addMemberAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { useTranslations } from "next-intl";

export function AddMemberForm({ teamId, candidates }: { teamId: string; candidates: { id: string; displayName: string; email: string }[] }) {
  const tcfg = useTranslations("cfg");
  const [state, action, pending] = useActionState(addMemberAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="teamId" value={teamId} />
      <NativeSelect name="userId" required className="min-w-72 flex-1" aria-label={tcfg("user")}>
        <option value="">{tcfg("selectUser")}</option>
        {candidates.map((c) => <option key={c.id} value={c.id}>{c.displayName} ({c.email})</option>)}
      </NativeSelect>
      <NativeSelect name="role" className="w-32" aria-label={tcfg("teamRole")}><option value="MEMBER">{tcfg("member")}</option><option value="LEAD">{tcfg("lead")}</option></NativeSelect>
      <Button type="submit" disabled={pending}><UserPlus /> {tcfg("add")}</Button>
      {state && !state.ok && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
