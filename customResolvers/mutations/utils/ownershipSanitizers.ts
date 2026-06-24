type ConnectByUsername = {
  connect: {
    where: {
      node: {
        username: string;
      };
    };
  };
};

const buildOwnerConnect = (username: string): ConnectByUsername => ({
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

export const sanitizeImagesFieldInput = (imagesField: unknown, username: string) => {
  if (!(imagesField as UnknownRecord | null | undefined)?.create) {
    return imagesField;
  }

  return {
    ...(imagesField as UnknownRecord),
    create: sanitizeImageCreateEntries((imagesField as UnknownRecord).create, username),
  };
};

export const sanitizeAlbumCreateInput = (albumInput: unknown, username: string) => {
  const { Owner, ...rest } = (albumInput as UnknownRecord) || {};

  const sanitized: UnknownRecord = {
    ...rest,
    Owner: buildOwnerConnect(username),
  };

  if (sanitized.Images) {
    sanitized.Images = sanitizeImagesFieldInput(sanitized.Images, username);
  }

  return sanitized;
};

export const sanitizeAlbumCreateNode = (node: unknown, username: string) => {
  if (!node) {
    return node;
  }

  return sanitizeAlbumCreateInput(node, username);
};

export const sanitizeAlbumUpdateNode = (node: unknown, username: string) => {
  if (!node) {
    return node;
  }

  const { Owner, ...rest } = node as UnknownRecord;

  const sanitized: UnknownRecord = {
    ...rest,
  };

  if (sanitized.Images) {
    sanitized.Images = sanitizeImagesFieldInput(sanitized.Images, username);
  }

  return sanitized;
};
