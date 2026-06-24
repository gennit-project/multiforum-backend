import type {
  AlbumCreateInput,
  AlbumUpdateInput,
  AlbumImagesFieldInput,
  AlbumOwnerFieldInput,
  ImageUploaderFieldInput,
} from "../../../ogm_types.js";

const buildOwnerConnect = (username: string): AlbumOwnerFieldInput => ({
  connect: {
    where: {
      node: {
        username,
      },
    },
  },
});

const buildUploaderConnect = (username: string): ImageUploaderFieldInput => ({
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

export const sanitizeAlbumUpdateNode = (
  node: unknown,
  username: string
): AlbumUpdateInput | null | undefined => {
  if (!node) {
    return node as null | undefined;
  }

  const { Owner, ...rest } = node as UnknownRecord;

  const sanitized: UnknownRecord = {
    ...rest,
  };

  if (sanitized.Images) {
    sanitized.Images = sanitizeImagesFieldInput(sanitized.Images, username);
  }

  return sanitized as AlbumUpdateInput;
};
