import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { attachQueue, emitNow, type RealtimeEvent } from "./realtime/bus";

/**
 * prisma.$transaction wrapper that delivers queued realtime events only after
 * the transaction has committed (events are dropped on rollback).
 */
export async function transaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  const queue: RealtimeEvent[] = [];
  const result = await prisma.$transaction(async (tx) => {
    attachQueue(tx, queue);
    return fn(tx);
  }, options);
  for (const e of queue) emitNow(e);
  return result;
}
