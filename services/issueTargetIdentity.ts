import { GraphQLError } from "graphql";

type IssueInput = Record<string, any>;

export type IssueTargetDefinition = {
  scalarField: string;
  relationshipField: string;
  relationshipType: string;
  targetLabel: string;
  targetKey: string;
};

export const issueTargetDefinitions: readonly IssueTargetDefinition[] = [
  {
    scalarField: "relatedDiscussionId",
    relationshipField: "TargetDiscussion",
    relationshipType: "TARGETS_DISCUSSION",
    targetLabel: "Discussion",
    targetKey: "id",
  },
  {
    scalarField: "relatedCommentId",
    relationshipField: "TargetComment",
    relationshipType: "TARGETS_COMMENT",
    targetLabel: "Comment",
    targetKey: "id",
  },
  {
    scalarField: "relatedEventId",
    relationshipField: "TargetEvent",
    relationshipType: "TARGETS_EVENT",
    targetLabel: "Event",
    targetKey: "id",
  },
  {
    scalarField: "relatedWikiPageId",
    relationshipField: "TargetWikiPage",
    relationshipType: "TARGETS_WIKI_PAGE",
    targetLabel: "WikiPage",
    targetKey: "id",
  },
  {
    scalarField: "relatedWikiRevisionId",
    relationshipField: "TargetWikiRevision",
    relationshipType: "TARGETS_WIKI_REVISION",
    targetLabel: "TextVersion",
    targetKey: "id",
  },
  {
    scalarField: "relatedImageId",
    relationshipField: "TargetImage",
    relationshipType: "TARGETS_IMAGE",
    targetLabel: "Image",
    targetKey: "id",
  },
  {
    scalarField: "relatedAlbumId",
    relationshipField: "TargetAlbum",
    relationshipType: "TARGETS_ALBUM",
    targetLabel: "Album",
    targetKey: "id",
  },
  {
    scalarField: "relatedUsername",
    relationshipField: "TargetUser",
    relationshipType: "TARGETS_USER",
    targetLabel: "User",
    targetKey: "username",
  },
  {
    scalarField: "relatedModProfileName",
    relationshipField: "TargetModProfile",
    relationshipType: "TARGETS_MOD_PROFILE",
    targetLabel: "ModerationProfile",
    targetKey: "displayName",
  },
  {
    scalarField: "relatedProfilePicUserId",
    relationshipField: "TargetProfilePictureUser",
    relationshipType: "TARGETS_PROFILE_PICTURE_USER",
    targetLabel: "User",
    targetKey: "username",
  },
  {
    scalarField: "relatedChannelUniqueName",
    relationshipField: "TargetChannel",
    relationshipType: "TARGETS_CHANNEL",
    targetLabel: "Channel",
    targetKey: "uniqueName",
  },
] as const;

export const issueImmutableFields = new Set([
  "issueNumber",
  "channelUniqueName",
  "authorName",
  "Channel",
  "Author",
  ...issueTargetDefinitions.flatMap((definition) => [
    definition.scalarField,
    definition.relationshipField,
  ]),
  "relatedChannelIconName",
  "relatedChannelBannerName",
]);

const targetConnection = (key: string, value: string) => ({
  connect: { where: { node: { [key]: value } } },
});

const collectConnectionValues = (
  relationshipInput: unknown,
  key: string
): unknown[] => {
  if (!relationshipInput || typeof relationshipInput !== "object") return [];
  const input = relationshipInput as Record<string, any>;
  const connects = Array.isArray(input.connect)
    ? input.connect
    : input.connect
      ? [input.connect]
      : [];
  return connects.map((entry) => entry?.where?.node?.[key]);
};

const assertMatchingConnection = (
  input: IssueInput,
  relationshipField: string,
  key: string,
  expectedValue: string | null | undefined
) => {
  const relationshipInput = input[relationshipField];
  if (relationshipInput === undefined) return;
  const values = collectConnectionValues(relationshipInput, key);
  if (
    !expectedValue ||
    values.length !== 1 ||
    values[0] !== expectedValue ||
    Object.keys(relationshipInput).some((operation) => operation !== "connect")
  ) {
    throw new GraphQLError(
      `${relationshipField} must match its immutable issue identity.`
    );
  }
};

const populated = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export const validateIssueIdentityInput = (input: IssueInput) => {
  if (!input || typeof input !== "object") {
    throw new GraphQLError("Issue input is required.");
  }
  if (!Number.isInteger(input.issueNumber) || input.issueNumber < 0) {
    throw new GraphQLError("Issue number must be a non-negative integer.");
  }
  if (!populated(input.authorName)) {
    throw new GraphQLError("Issue author identity is required.");
  }

  const authorConnections = [
    ...collectConnectionValues(input.Author?.User, "username"),
    ...collectConnectionValues(
      input.Author?.ModerationProfile,
      "displayName"
    ),
  ];
  if (
    authorConnections.length !== 1 ||
    authorConnections[0] !== input.authorName
  ) {
    throw new GraphQLError(
      "Issue author relationship must match the immutable author snapshot."
    );
  }

  assertMatchingConnection(
    input,
    "Channel",
    "uniqueName",
    input.channelUniqueName
  );

  for (const definition of issueTargetDefinitions) {
    assertMatchingConnection(
      input,
      definition.relationshipField,
      definition.targetKey,
      input[definition.scalarField]
    );
  }

  if (
    populated(input.relatedUsername) &&
    populated(input.relatedModProfileName)
  ) {
    throw new GraphQLError(
      "An issue cannot target both a user and a moderation profile."
    );
  }
  if (
    populated(input.relatedWikiRevisionId) &&
    !populated(input.relatedWikiPageId)
  ) {
    throw new GraphQLError("A wiki revision target requires its wiki page.");
  }
  if (
    populated(input.relatedProfilePicUserId) &&
    populated(input.relatedUsername) &&
    input.relatedProfilePicUserId !== input.relatedUsername
  ) {
    throw new GraphQLError(
      "Profile-picture and user target identities must match."
    );
  }
  if (
    populated(input.relatedChannelIconName) &&
    populated(input.relatedChannelBannerName)
  ) {
    throw new GraphQLError(
      "An issue cannot target both a channel icon and banner."
    );
  }
  for (const field of ["relatedChannelIconName", "relatedChannelBannerName"]) {
    if (
      populated(input[field]) &&
      input[field] !== input.relatedChannelUniqueName
    ) {
      throw new GraphQLError(
        "Channel image identity must match the targeted channel."
      );
    }
  }

  const primaryContentFields = [
    "relatedDiscussionId",
    "relatedCommentId",
    "relatedEventId",
    "relatedWikiPageId",
    "relatedImageId",
    "relatedAlbumId",
    "relatedProfilePicUserId",
    "relatedChannelUniqueName",
  ].filter((field) => populated(input[field]));
  if (primaryContentFields.length > 1) {
    throw new GraphQLError("An issue must have exactly one primary target.");
  }
  if (
    primaryContentFields.length === 0 &&
    !populated(input.relatedUsername) &&
    !populated(input.relatedModProfileName)
  ) {
    throw new GraphQLError("An issue target is required.");
  }
};

export const attachIssueIdentityRelationships = <T extends IssueInput>(
  input: T
): T => {
  validateIssueIdentityInput(input);
  const output: IssueInput = { ...input };

  if (populated(input.channelUniqueName)) {
    output.Channel = targetConnection("uniqueName", input.channelUniqueName);
  } else {
    delete output.Channel;
  }

  for (const definition of issueTargetDefinitions) {
    const value = input[definition.scalarField];
    if (populated(value)) {
      output[definition.relationshipField] = targetConnection(
        definition.targetKey,
        value
      );
    } else {
      delete output[definition.relationshipField];
    }
  }
  return output as T;
};

export const assertIssueIdentityUpdateAllowed = (update: unknown) => {
  const updates = Array.isArray(update) ? update : update ? [update] : [];
  for (const entry of updates) {
    if (!entry || typeof entry !== "object") continue;
    const attempted = Object.keys(entry).filter((key) =>
      issueImmutableFields.has(key)
    );
    if (attempted.length) {
      throw new GraphQLError(
        `Issue identity cannot be updated: ${attempted.sort().join(", ")}.`
      );
    }
  }
};

export const protectIssueModelIdentity = <T extends object>(model: T): T =>
  new Proxy(model, {
    get(target, property, receiver) {
      if (property === "create") {
        return (options: Record<string, any>) => (target as any).create({
          ...options,
          input: (options.input ?? []).map((entry: IssueInput) =>
            attachIssueIdentityRelationships(entry)
          ),
        });
      }
      if (property === "update") {
        return (options: Record<string, any>) => {
          assertIssueIdentityUpdateAllowed(options.update);
          return (target as any).update(options);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
