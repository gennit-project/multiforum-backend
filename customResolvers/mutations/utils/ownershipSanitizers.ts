import type {
  AlbumCreateInput,
  AlbumImagesFieldInput,
  CollectionCreateInput,
  CollectionVisibility,
} from "../../../ogm_types.js";

// FAMILY-3 / v7 (campaign #284). v7 removed the nested to-one connect from the
// generated Album/Collection/Image create inputs, so these builders no longer
// type against the generated *FieldInput shapes. The sanitizers still stamp the
// owner/uploader identity into this intermediate connect shape; ownershipCreate
// middleware reads the identity out of it and wires the edges with an owned
// post-create write rather than passing the connect to the generated mutation.
type ConnectByUsername = { connect: { where: { node: { username: string } } } };

const buildOwnerConnect = (username: string): ConnectByUsername => ({
  connect: {
    where: {
      node: {
        username,
      },
    },
  },
});

const buildCreatedByConnect = (username: string): ConnectByUsername => ({
  connect: {
    where: {
      node: {
        username,
      },
    },
  },
});

const buildUploaderConnect = (username: string): ConnectByUsername => ({
  connect: {
    where: {
      node: {
        username,
      },
    },
  },
});

type UnknownRecord = Record<string, unknown>;

const sanitizeImageCreateEntries = (createInput: unknown, username: string) => {
  if (!createInput) {
    return createInput;
  }

  const createArray = Array.isArray(createInput) ? createInput : [createInput];

  return createArray.map((entry) => {
    if (!entry || !(entry as UnknownRecord).node) {
      return entry;
    }

    const { Uploader, ...restNode } = (entry as UnknownRecord).node as UnknownRecord;

    return {
      ...(entry as UnknownRecord),
      node: {
        ...restNode,
        Uploader: buildUploaderConnect(username),
      },
    };
  });
};

export const sanitizeImagesFieldInput = (
  imagesField: unknown,
  username: string
): AlbumImagesFieldInput | null | undefined => {
  if (!(imagesField as UnknownRecord | null | undefined)?.create) {
    return imagesField as AlbumImagesFieldInput | null | undefined;
  }

  return {
    ...(imagesField as UnknownRecord),
    create: sanitizeImageCreateEntries((imagesField as UnknownRecord).create, username),
  } as AlbumImagesFieldInput;
};

export const sanitizeAlbumCreateInput = (
  albumInput: unknown,
  username: string
): AlbumCreateInput => {
  const { Owner, ...rest } = (albumInput as UnknownRecord) || {};

  const sanitized: UnknownRecord = {
    ...rest,
    Owner: buildOwnerConnect(username),
  };

  if (sanitized.Images) {
    sanitized.Images = sanitizeImagesFieldInput(sanitized.Images, username);
  }

  return sanitized as AlbumCreateInput;
};

export const sanitizeAlbumCreateNode = (
  node: unknown,
  username: string
): AlbumCreateInput | null | undefined => {
  if (!node) {
    return node as null | undefined;
  }

  return sanitizeAlbumCreateInput(node, username);
};

export const sanitizeCollectionCreateInput = (
  collectionInput: unknown,
  username: string
): CollectionCreateInput => {
  // Strip any client-supplied CreatedBy and force ownership to the
  // authenticated user, so a caller can't create a collection owned by
  // someone else.
  const { CreatedBy, ...rest } = (collectionInput as UnknownRecord) || {};

  return {
    ...rest,
    visibility:
      ((rest as Partial<CollectionCreateInput>).visibility as CollectionVisibility | undefined) ??
      "PRIVATE",
    CreatedBy: buildCreatedByConnect(username),
  } as unknown as CollectionCreateInput;
};

// v7's AlbumUpdateInput no longer carries the Owner relationship at all, so the
// sanitized update node is a loose record (Owner is stripped; the owned write
// owns album ownership).
export const sanitizeAlbumUpdateNode = (
  node: unknown,
  username: string
): UnknownRecord | null | undefined => {
  if (!node) {
    return node as null | undefined;
  }

  const { Owner, ...rest } = node as UnknownRecord;
  void Owner;

  const sanitized: UnknownRecord = {
    ...rest,
  };

  if (sanitized.Images) {
    sanitized.Images = sanitizeImagesFieldInput(sanitized.Images, username);
  }

  return sanitized;
};
