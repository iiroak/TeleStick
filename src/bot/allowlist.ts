import type { Context, NextFunction } from "grammy";

export function allowlist(allowedUserIds: ReadonlySet<number>) {
  return async (ctx: Context, next: NextFunction) => {
    const userId = ctx.from?.id;
    if (ctx.chat?.type !== "private" || !userId || !allowedUserIds.has(userId)) {
      return;
    }
    await next();
  };
}
