// Shared helpers for the version-history services (discussion / comment /
// wikiPage). Creating a TextVersion authored by a user and connecting it to a
// parent node is identical across all three; only the parent model and the
// relationship field differ. These functions take the OGM directly so they can
// be unit-tested against a live database without standing up a subscription.

export interface OGMLike {
  model(name: string): any;
}

export interface CreateTextVersionInput {
  body: string;
  username: string;
  editReason?: string | null;
}

/**
 * Create a TextVersion (body + optional editReason) authored by `username`.
 * Returns the new TextVersion id, or null if the body is empty or the user
 * does not exist (the caller treats null as "nothing to track").
 */
export const createAuthoredTextVersion = async (
  ogm: OGMLike,
  { body, username, editReason }: CreateTextVersionInput
): Promise<string | null> => {
  if (!body) {
    return null;
  }
  if (!username) {
    return null;
  }

  const UserModel = ogm.model("User");
  const users = await UserModel.find({
    where: { username },
    selectionSet: `{ username }`,
  });
  if (!users.length) {
    return null;
  }

  const TextVersionModel = ogm.model("TextVersion");
  const input: { body: string; editReason?: string; Author: any } = {
    body,
    Author: {
      connect: { where: { node: { username } } },
    },
  };
  if (editReason) {
    input.editReason = editReason;
  }

  const result = await TextVersionModel.create({ input: [input] });
  return result.textVersions[0]?.id ?? null;
};

/**
 * Connect an existing TextVersion to a parent node's relationship field
 * (e.g. Discussion.PastBodyVersions, Comment.PastVersions).
 */
export const connectTextVersionToParent = async (
  ogm: OGMLike,
  params: {
    parentModelName: string;
    parentId: string;
    relationshipField: string;
    textVersionId: string;
  }
): Promise<void> => {
  const { parentModelName, parentId, relationshipField, textVersionId } = params;
  const ParentModel = ogm.model(parentModelName);
  await ParentModel.update({
    where: { id: parentId },
    update: {
      [relationshipField]: {
        connect: [{ where: { node: { id: textVersionId } } }],
      },
    },
  });
};

/**
 * Create an authored TextVersion and connect it to a parent in one step.
 * Returns the TextVersion id, or null if nothing was created.
 */
export const trackTextVersion = async (
  ogm: OGMLike,
  params: CreateTextVersionInput & {
    parentModelName: string;
    parentId: string;
    relationshipField: string;
  }
): Promise<string | null> => {
  const { parentModelName, parentId, relationshipField, ...versionInput } = params;
  const textVersionId = await createAuthoredTextVersion(ogm, versionInput);
  if (!textVersionId) {
    return null;
  }
  await connectTextVersionToParent(ogm, {
    parentModelName,
    parentId,
    relationshipField,
    textVersionId,
  });
  return textVersionId;
};
