import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/get-actor";

export default async function Home() {
  await requireActor();
  redirect("/dashboard");
}
