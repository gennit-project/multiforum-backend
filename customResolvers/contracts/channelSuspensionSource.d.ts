import type { ServerUserSuspensionSource, ServerModSuspensionSource } from "./serverSuspensionSource.js";
// Channel queries select the same targeted properties without server scope keys.
export type ChannelUserSuspensionSource = Omit<ServerUserSuspensionSource, "serverName" | "channelUniqueName">;
export type ChannelModSuspensionSource = Omit<ServerModSuspensionSource, "serverName" | "channelUniqueName">;
