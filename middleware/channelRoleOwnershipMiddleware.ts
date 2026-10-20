import { resolveRoleGuardRepository } from "../services/persistence/roleGuardRepository.js";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";

type Resolver = (
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;

type RoleModelName = "ChannelRole" | "ModChannelRole";

const roleRelationships: Array<{
  field: string;
  modelName: RoleModelName;
}> = [
  { field: "DefaultChannelRole", modelName: "ChannelRole" },
  { field: "ElevatedChannelRole", modelName: "ChannelRole" },
  { field: "SuspendedRole", modelName: "ChannelRole" },
  { field: "DefaultModRole", modelName: "ModChannelRole" },
  { field: "ElevatedModRole", modelName: "ModChannelRole" },
  { field: "SuspendedModRole", modelName: "ModChannelRole" },
];

const ownerConnection = (channelUniqueName: string) => ({
  connect: {
    where: { node: { uniqueName: channelUniqueName } },
  },
});

const asArray = <T>(value: T | T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : value == null ? [] : [value];

export const getConnectedOwnerChannelNames = (ownerInput: unknown): string[] => {
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    const node = object.node;
    if (node && typeof node === "object") {
      const uniqueName = (node as Record<string, unknown>).uniqueName;
      if (typeof uniqueName === "string" && uniqueName.trim()) {
        names.add(uniqueName);
      }
    }
    Object.values(object).forEach(visit);
  };
  visit((ownerInput as Record<string, unknown> | null)?.connect);
  return [...names];
};

export const attachChannelRoleOwner = (
  input: Record<string, any>,
  expectedChannelUniqueName?: string
) => {
  const ownerNames = getConnectedOwnerChannelNames(input.Owner);
  if (ownerNames.length > 1) {
    throw new GraphQLError("A channel role must connect to exactly one owning channel.");
  }
  const channelUniqueName = expectedChannelUniqueName ?? ownerNames[0];
  if (!channelUniqueName) {
    throw new GraphQLError("An owning channel connection is required when creating a channel role.");
  }
  if (ownerNames[0] && ownerNames[0] !== channelUniqueName) {
    throw new GraphQLError("Channel role ownership must match the channel receiving the role.");
  }
  if (input.channelUniqueName && input.channelUniqueName !== channelUniqueName) {
    throw new GraphQLError("Channel role ownership must match channelUniqueName.");
  }
  return {
    ...input,
    channelUniqueName,
    Owner: ownerConnection(channelUniqueName),
  };
};

const mapCreate = (create: any, channelUniqueName: string) => {
  const mapped = asArray(create).map((entry) => ({
    ...entry,
    node: attachChannelRoleOwner(entry?.node ?? {}, channelUniqueName),
  }));
  return Array.isArray(create) ? mapped : mapped[0];
};

const scopeConnect = (connect: any, channelUniqueName: string) => {
  const mapped = asArray(connect).map((entry) => {
    const where = entry?.where;
    const node = where?.node;
    if (!node || typeof node !== "object") {
      throw new GraphQLError("Channel role connections require a node filter.");
    }
    return {
      ...entry,
      where: {
        ...where,
        node: { ...node, channelUniqueName },
      },
    };
  });
  return Array.isArray(connect) ? mapped : mapped[0];
};

const containsKey = (value: unknown, key: string): boolean => {
  if (Array.isArray(value)) return value.some((entry) => containsKey(entry, key));
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(object, key) ||
    Object.values(object).some((entry) => containsKey(entry, key));
};

const prepareRelationshipUpdate = (value: any, channelUniqueName: string) => {
  const mapped = asArray(value).map((operation) => {
    if (operation?.connectOrCreate) {
      throw new GraphQLError(
        "Channel role connectOrCreate is not supported; create or connect an owned role explicitly."
      );
    }
    for (const nestedOperation of ["connect", "update", "disconnect", "delete"]) {
      if (containsKey(operation?.[nestedOperation], "Owner")) {
        throw new GraphQLError("Channel role ownership cannot be changed after creation.");
      }
    }
    return {
      ...operation,
      ...(operation?.create
        ? { create: mapCreate(operation.create, channelUniqueName) }
        : {}),
      ...(operation?.connect
        ? { connect: scopeConnect(operation.connect, channelUniqueName) }
        : {}),
    };
  });
  return Array.isArray(value) ? mapped : mapped[0];
};

const connectFilters = (value: any): Record<string, unknown>[] =>
  asArray(value).flatMap((operation) =>
    asArray(operation?.connect)
      .map((entry) => entry?.where?.node)
      .filter((where): where is Record<string, unknown> => !!where)
  );

const validateConnects = async (
  value: any,
  modelName: RoleModelName,
  channelUniqueName: string,
  context: GraphQLContext
) => {
  for (const where of connectFilters(value)) {
    const repository = resolveRoleGuardRepository(context);
    const roles = modelName === "ChannelRole"
      ? await repository.findChannelRoleOwners(where)
      : await repository.findModChannelRoleOwners(where);
    if (
      roles.length === 0 ||
      roles.some((role) => role.Owner?.uniqueName !== channelUniqueName)
    ) {
      throw new GraphQLError(
        `A ${modelName} can only be attached to its owning channel.`
      );
    }
  }
};

const channelUniqueNameFromWhere = (where: Record<string, unknown> | undefined) => {
  const value = where?.uniqueName;
  return typeof value === "string" && value ? value : null;
};

const prepareChannelInput = (
  input: Record<string, any>,
  channelUniqueName: string
) => {
  const prepared = { ...input };
  for (const { field } of roleRelationships) {
    if (prepared[field]) {
      prepared[field] = prepareRelationshipUpdate(prepared[field], channelUniqueName);
    }
  }
  return prepared;
};

export const createChannelRolesWithOwners = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => resolve(
  parent,
  {
    ...args,
    input: (args.input ?? []).map((input: Record<string, any>) =>
      attachChannelRoleOwner(input)
    ),
  },
  context,
  info
);

export const createChannelsWithOwnedRoles = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => resolve(
  parent,
  {
    ...args,
    input: (args.input ?? []).map((input: Record<string, any>) => {
      if (!input.uniqueName) {
        throw new GraphQLError("A channel uniqueName is required when creating channel roles.");
      }
      return prepareChannelInput(input, input.uniqueName);
    }),
  },
  context,
  info
);

export const updateChannelsWithOwnedRoles = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  const touchedRelationships = roleRelationships.filter(({ field }) => args.update?.[field]);
  if (touchedRelationships.length === 0) {
    return resolve(parent, args, context, info);
  }
  const channelUniqueName = channelUniqueNameFromWhere(args.where);
  if (!channelUniqueName) {
    throw new GraphQLError(
      "A single channel uniqueName is required when changing channel roles."
    );
  }
  const preparedUpdate = prepareChannelInput(args.update, channelUniqueName);
  for (const { field, modelName } of touchedRelationships) {
    await validateConnects(
      preparedUpdate[field],
      modelName,
      channelUniqueName,
      context
    );
  }
  return resolve(
    parent,
    { ...args, update: preparedUpdate },
    context,
    info
  );
};

export const updateChannelRolesWithoutOwnerChanges = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  const relationshipOperations = [
    "connect",
    "disconnect",
    "create",
    "connectOrCreate",
    "delete",
  ];
  if (
    args.update?.Owner ||
    relationshipOperations.some((operation) => args[operation])
  ) {
    throw new GraphQLError("Channel role ownership cannot be changed after creation.");
  }
  return resolve(parent, args, context, info);
};

export default {
  Mutation: {
    createChannelRoles: createChannelRolesWithOwners,
    createModChannelRoles: createChannelRolesWithOwners,
    updateChannelRoles: updateChannelRolesWithoutOwnerChanges,
    updateModChannelRoles: updateChannelRolesWithoutOwnerChanges,
    deleteChannelRoles: updateChannelRolesWithoutOwnerChanges,
    deleteModChannelRoles: updateChannelRolesWithoutOwnerChanges,
    createChannels: createChannelsWithOwnedRoles,
    updateChannels: updateChannelsWithOwnedRoles,
  },
};
