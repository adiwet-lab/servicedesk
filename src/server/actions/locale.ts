"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { getActor } from "@/server/auth/get-actor";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

/** Switches the UI language: stored on the user (when signed in) and in a cookie (login page, sign-out). */
export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return;
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365, httpOnly: false });
  const actor = await getActor();
  if (actor && actor.locale !== locale) await prisma.user.update({ where: { id: actor.id }, data: { locale } });
  revalidatePath("/", "layout");
}
