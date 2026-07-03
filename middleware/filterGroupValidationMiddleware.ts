import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";

const VALID_GROUP_KEY = /^[a-zA-Z0-9_]+$/;
const VALID_OPTION_VALUE = /^[a-zA-Z0-9_-]+$/;
const VALID_MODES = new Set(["INCLUDE", "EXCLUDE"]);

type Resolver = (
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;

type MiddlewareResolver = (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;

type FilterGroupLike = {
  key?: unknown;
  displayName?: unknown;
  mode?: unknown;
  order?: unknown;
  options?: unknown;
};

type FilterOptionLike = {
  value?: unknown;
  displayName?: unknown;
  order?: unknown;
};

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const assertNonEmptyString = (value: unknown, field: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
};

const assertInteger = (value: unknown, field: string) => {
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
};

const validateOptionNode = (option: FilterOptionLike, label: string) => {
  assertNonEmptyString(option.value, `${label}.value`);
  if (!VALID_OPTION_VALUE.test(String(option.value))) {
    throw new Error(`${label}.value can only contain letters, numbers, underscores, and hyphens`);
  }
  assertNonEmptyString(option.displayName, `${label}.displayName`);
  if (option.order !== undefined) {
    assertInteger(option.order, `${label}.order`);
  }
};

const getCreatedOptionNodesFromField = (options: unknown): FilterOptionLike[] => {
  if (!options || typeof options !== "object") {
    return [];
  }
  const optionInput = options as { create?: unknown };
  return asArray(optionInput.create)
    .map((entry) => (entry as { node?: FilterOptionLike })?.node)
    .filter((node): node is FilterOptionLike => Boolean(node));
};

const getCreatedOptionNodes = (options: unknown): FilterOptionLike[] => {
  if (Array.isArray(options)) {
    return options.flatMap(getCreatedOptionNodesFromField);
  }
  return getCreatedOptionNodesFromField(options);
};

const getUpdatedOptionNodes = (options: unknown): FilterOptionLike[] => {
  return asArray(options)
    .map((entry) => (entry as { update?: { node?: FilterOptionLike } })?.update?.node)
    .filter((node): node is FilterOptionLike => Boolean(node));
};

const validateOptions = (group: FilterGroupLike, label: string) => {
  const optionNodes = [
    ...getCreatedOptionNodes(group.options),
    ...getUpdatedOptionNodes(group.options),
  ];
  const values = new Set<string>();

  optionNodes.forEach((option, index) => {
    validateOptionNode(option, `${label}.options[${index}]`);
    const normalizedValue = String(option.value).trim().toLowerCase();
    if (values.has(normalizedValue)) {
      throw new Error(`${label} has duplicate option value "${option.value}"`);
    }
    values.add(normalizedValue);
  });
};

const assertHasCreatedOptions = (group: FilterGroupLike, label: string) => {
  if (getCreatedOptionNodes(group.options).length === 0) {
    throw new Error(`${label} must include at least one option`);
  }
};

export const validateFilterGroupNode = (
  group: FilterGroupLike,
  label: string,
  partial = false
) => {
  if (!partial || group.key !== undefined) {
    assertNonEmptyString(group.key, `${label}.key`);
    if (!VALID_GROUP_KEY.test(String(group.key))) {
      throw new Error(`${label}.key can only contain letters, numbers, and underscores`);
    }
  }
  if (!partial || group.displayName !== undefined) {
    assertNonEmptyString(group.displayName, `${label}.displayName`);
  }
  if (!partial || group.mode !== undefined) {
    if (!VALID_MODES.has(String(group.mode))) {
      throw new Error(`${label}.mode must be INCLUDE or EXCLUDE`);
    }
  }
  if (!partial || group.order !== undefined) {
    assertInteger(group.order, `${label}.order`);
  }
  validateOptions(group, label);
};

const extractChannelFilterGroupCreates = (args: Record<string, unknown>): FilterGroupLike[] =>
  asArray((args.update as { FilterGroups?: unknown } | undefined)?.FilterGroups)
    .flatMap((entry) => asArray((entry as { create?: unknown })?.create))
    .map((entry) => (entry as { node?: FilterGroupLike })?.node)
    .filter((node): node is FilterGroupLike => Boolean(node));

const extractChannelCreateFilterGroupCreates = (args: Record<string, unknown>): FilterGroupLike[] =>
  asArray(args.input)
    .flatMap((channelInput) =>
      asArray((channelInput as { FilterGroups?: unknown })?.FilterGroups)
    )
    .flatMap((entry) => asArray((entry as { create?: unknown })?.create))
    .map((entry) => (entry as { node?: FilterGroupLike })?.node)
    .filter((node): node is FilterGroupLike => Boolean(node));

const extractChannelFilterGroupUpdates = (args: Record<string, unknown>): FilterGroupLike[] =>
  asArray((args.update as { FilterGroups?: unknown } | undefined)?.FilterGroups)
    .filter((entry) => (entry as { update?: unknown })?.update)
    .map((entry) => (entry as { update: { node?: FilterGroupLike } }).update.node)
    .filter((node): node is FilterGroupLike => Boolean(node));

export const validateChannelFilterGroupPayload = (args: Record<string, unknown>) => {
  const creates = [
    ...extractChannelCreateFilterGroupCreates(args),
    ...extractChannelFilterGroupCreates(args),
  ];
  const updates = extractChannelFilterGroupUpdates(args);
  const keys = new Set<string>();

  creates.forEach((group, index) => {
    const label = `FilterGroups.create[${index}]`;
    validateFilterGroupNode(group, label);
    assertHasCreatedOptions(group, label);
    const normalizedKey = String(group.key).trim().toLowerCase();
    if (keys.has(normalizedKey)) {
      throw new Error(`Duplicate filter group key "${group.key}"`);
    }
    keys.add(normalizedKey);
  });

  updates.forEach((group, index) => {
    validateFilterGroupNode(group, `FilterGroups.update[${index}]`, true);
  });
};

export const validateCreateFilterGroupsPayload = (args: Record<string, unknown>) => {
  const keys = new Set<string>();
  asArray(args.input).forEach((group, index) => {
    const label = `input[${index}]`;
    validateFilterGroupNode(group as FilterGroupLike, label);
    assertHasCreatedOptions(group as FilterGroupLike, label);
    const normalizedKey = String((group as FilterGroupLike).key).trim().toLowerCase();
    if (keys.has(normalizedKey)) {
      throw new Error(`Duplicate filter group key "${(group as FilterGroupLike).key}"`);
    }
    keys.add(normalizedKey);
  });
};

export const validateUpdateFilterGroupsPayload = (args: Record<string, unknown>) => {
  if (args.update) {
    validateFilterGroupNode(args.update as FilterGroupLike, "update", true);
  }
};

const withFilterGroupValidation = (validate: (args: Record<string, unknown>) => void): MiddlewareResolver =>
  async (resolve, parent, args, context, info) => {
    validate(args);
    return resolve(parent, args, context, info);
  };

const filterGroupValidationMiddleware = {
  Mutation: {
    createChannels: withFilterGroupValidation(validateChannelFilterGroupPayload),
    updateChannels: withFilterGroupValidation(validateChannelFilterGroupPayload),
    createFilterGroups: withFilterGroupValidation(validateCreateFilterGroupsPayload),
    updateFilterGroups: withFilterGroupValidation(validateUpdateFilterGroupsPayload),
  },
};

export default filterGroupValidationMiddleware;
