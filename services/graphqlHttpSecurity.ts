import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";

// GraphQL carries operation documents and metadata only. Media and downloadable
// files are uploaded directly to object storage, so accepting tens of megabytes
// here only increases HTTP parsing memory and denial-of-service exposure.
export const GRAPHQL_JSON_BODY_LIMIT_BYTES = 1024 * 1024;
export const GRAPHQL_JSON_BODY_LIMIT_LABEL = "1 MiB";

export const createGraphQLJsonBodyParser = (): RequestHandler =>
  express.json({ limit: GRAPHQL_JSON_BODY_LIMIT_BYTES });

type HttpBodyParserError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

const isPayloadTooLarge = (error: unknown): error is HttpBodyParserError => {
  if (!(error instanceof Error)) return false;
  const candidate = error as HttpBodyParserError;
  return candidate.status === 413 ||
    candidate.statusCode === 413 ||
    candidate.type === "entity.too.large";
};

/** Return a stable GraphQL-shaped response without allowing Apollo to execute. */
export const graphqlPayloadTooLargeErrorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next
) => {
  if (!isPayloadTooLarge(error)) {
    next(error);
    return;
  }

  res.status(413).json({
    errors: [
      {
        message: `GraphQL request body must not exceed ${GRAPHQL_JSON_BODY_LIMIT_LABEL}.`,
        extensions: {
          code: "PAYLOAD_TOO_LARGE",
          maximumBytes: GRAPHQL_JSON_BODY_LIMIT_BYTES,
        },
      },
    ],
  });
};
