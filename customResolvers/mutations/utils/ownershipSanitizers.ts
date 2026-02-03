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

const sanitizeImageCreateEntries = (createInput: any, username: string) => {
  if (!createInput) {
    return createInput;
  }

  const createArray = Array.isArray(createInput) ? createInput : [createInput];

  return createArray.map((entry) => {
    if (!entry || !entry.node) {
      return entry;
    }

    const { Uploader, ...restNode } = entry.node;

    return {
      ...entry,
      node: {
        ...restNode,
        Uploader: buildUploaderConnect(username),
      },
    };
  });
};

export const sanitizeImagesFieldInput = (imagesField: any, username: string) => {
  if (!imagesField?.create) {
    return imagesField;
  }

  return {
    ...imagesField,
    create: sanitizeImageCreateEntries(imagesField.create, username),
  };
};

export const sanitizeAlbumCreateInput = (albumInput: any, username: string) => {
  const { Owner, ...rest } = albumInput || {};

  const sanitized: any = {
    ...rest,
    Owner: buildOwnerConnect(username),
  };

  if (sanitized.Images) {
    sanitized.Images = sanitizeImagesFieldInput(sanitized.Images, username);
  }

  return sanitized;
};

export const sanitizeAlbumCreateNode = (node: any, username: string) => {
  if (!node) {
    return node;
  }

  return sanitizeAlbumCreateInput(node, username);
};

export const sanitizeAlbumUpdateNode = (node: any, username: string) => {
  if (!node) {
    return node;
  }

  const { Owner, ...rest } = node;

  const sanitized: any = {
    ...rest,
  };

  if (sanitized.Images) {
    sanitized.Images = sanitizeImagesFieldInput(sanitized.Images, username);
  }

  return sanitized;
};
