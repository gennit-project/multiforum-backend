// Native property maps: keys are selected by Cypher, values are not yet scalars.
export type NativeAgePolicy = {
  accountAgeGateEnabled: unknown;
  minimumAccountAge: unknown;
  sensitiveContentAgeGateEnabled: unknown;
  minimumSensitiveContentAge: unknown;
};
export type NativeSetupPolicy = {
  serverName: unknown;
  enableDownloads: unknown;
  enableEvents: unknown;
};
export type NativeInstancePolicySelections = {
  age: NativeAgePolicy;
  setup: NativeSetupPolicy;
};
export type CompletedAgePolicy = {
  accountAgeGateEnabled: boolean | null;
  minimumAccountAge: number | null;
  sensitiveContentAgeGateEnabled: boolean | null;
  minimumSensitiveContentAge: number | null;
};
export type CompletedSetupPolicy = {
  enableDownloads: boolean | null;
  enableEvents: boolean | null;
};
