// Factory for the resolver `context` object, composing the fake driver and OGM.
//
// Resolvers receive a context shaped like `{ driver, ogm, user, req }`. Use
// `makeContext` for the whole object, or `makeUser` alone when a resolver only
// needs the user. The user's `data` carries the moderation profile; channel and
// server role data is fetched live by the permission rules, not from the user.

import { makeDriver, type DriverCalls, type DriverOptions } from "./driver.js";
import { makeOgm, type ModelStub, type OgmCalls } from "./ogm.js";

export interface UserOptions {
  username?: string;
  [key: string]: unknown;
}

export function makeUser(overrides: UserOptions = {}) {
  const { username = "testuser", ...rest } = overrides;
  return {
    username,
    data: {},
    ...rest,
  };
}

export interface ContextOptions {
  // Pass `null` to simulate an unauthenticated request; omit for a default user.
  user?: ReturnType<typeof makeUser> | null;
  driver?: DriverOptions;
  models?: Record<string, ModelStub>;
  req?: { headers?: Record<string, string> };
}

export function makeContext(options: ContextOptions = {}): {
  context: Record<string, unknown>;
  driverCalls: DriverCalls;
  ogmCalls: OgmCalls;
} {
  const { driver, calls: driverCalls } = makeDriver(options.driver);
  const { ogm, calls: ogmCalls } = makeOgm(options.models);

  const context = {
    driver,
    ogm,
    user: options.user === undefined ? makeUser() : options.user,
    req: options.req ?? { headers: {} },
  };

  return { context, driverCalls, ogmCalls };
}
