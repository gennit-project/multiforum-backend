import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";

/**
 * Validation for the ServerConfig branding fields.
 *
 * Clients sanitize branding before rendering it, but the API must reject unsafe
 * values at write time as well: these fields are admin-editable free text that
 * ends up in `href` attributes, so a stored `javascript:` URL would be a
 * persistent injection against every client that trusts the API.
 */

const BRANDING_URL_FIELDS = [
  "brandingDocsURL",
  "brandingSourceURL",
  "brandingIssuesURL",
  "brandingLogoDarkURL",
  "brandingFaviconURL",
] as const;

const MAX_URL_LENGTH = 2048;
const MAX_TEXT_LENGTH = 120;
export const MAX_CUSTOM_FOOTER_LINKS = 8;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Absolute http(s) URLs and site-relative paths only. A protocol-relative
 * `//evil.example` reads as a path but is not one, so it is rejected too.
 */
export function isSafeBrandingUrl(value: string): boolean {
  if (value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function validateOptionalUrl(field: string, value: unknown): true | string {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return `${field} must be a string.`;
  const trimmed = value.trim();
  // An empty value clears the field, which is how a deployment opts out of a link.
  if (trimmed === "") return true;
  if (trimmed.length > MAX_URL_LENGTH) {
    return `${field} must be ${MAX_URL_LENGTH} characters or fewer.`;
  }
  if (!isSafeBrandingUrl(trimmed)) {
    return `${field} must be an http(s) URL or a site-relative path.`;
  }
  return true;
}

function validateCustomFooterLinks(value: unknown): true | string {
  if (value === null || value === undefined) return true;

  let links = value;
  if (typeof links === "string") {
    const trimmed = links.trim();
    if (trimmed === "") return true;
    try {
      links = JSON.parse(trimmed);
    } catch {
      return "brandingCustomFooterLinks must be valid JSON.";
    }
  }

  if (!Array.isArray(links)) {
    return "brandingCustomFooterLinks must be an array of {label, url} objects.";
  }
  if (links.length > MAX_CUSTOM_FOOTER_LINKS) {
    return `brandingCustomFooterLinks may contain at most ${MAX_CUSTOM_FOOTER_LINKS} links.`;
  }

  for (const link of links) {
    if (!link || typeof link !== "object" || Array.isArray(link)) {
      return "Each branding footer link must be an object with label and url.";
    }
    const { label, url } = link as Record<string, unknown>;
    if (typeof label !== "string" || label.trim() === "") {
      return "Each branding footer link needs a non-empty label.";
    }
    if (label.length > MAX_TEXT_LENGTH) {
      return `Branding footer link labels must be ${MAX_TEXT_LENGTH} characters or fewer.`;
    }
    if (typeof url !== "string" || !isSafeBrandingUrl(url.trim())) {
      return "Each branding footer link needs an http(s) URL or a site-relative path.";
    }
  }

  return true;
}

export function validateServerBrandingInput(input: unknown): true | string {
  if (!input || typeof input !== "object") return true;

  const config = input as Record<string, unknown>;

  for (const field of BRANDING_URL_FIELDS) {
    if (field in config) {
      const result = validateOptionalUrl(field, config[field]);
      if (result !== true) return result;
    }
  }

  for (const field of ["brandingProductName", "brandingLogoAlt"] as const) {
    if (field in config && config[field] !== null && config[field] !== undefined) {
      const value = config[field];
      if (typeof value !== "string") return `${field} must be a string.`;
      if (value.length > MAX_TEXT_LENGTH) {
        return `${field} must be ${MAX_TEXT_LENGTH} characters or fewer.`;
      }
    }
  }

  if ("brandingSupportEmail" in config) {
    const value = config.brandingSupportEmail;
    if (value !== null && value !== undefined) {
      if (typeof value !== "string") return "brandingSupportEmail must be a string.";
      const trimmed = value.trim();
      if (trimmed !== "" && !EMAIL_PATTERN.test(trimmed)) {
        return "brandingSupportEmail must be a valid email address.";
      }
    }
  }

  if ("brandingPrimaryColor" in config) {
    const value = config.brandingPrimaryColor;
    if (value !== null && value !== undefined) {
      if (typeof value !== "string") return "brandingPrimaryColor must be a string.";
      const trimmed = value.trim();
      if (trimmed !== "" && !HEX_COLOR_PATTERN.test(trimmed)) {
        return "brandingPrimaryColor must be a hex color such as #f97316.";
      }
    }
  }

  if ("brandingCustomFooterLinks" in config) {
    const result = validateCustomFooterLinks(config.brandingCustomFooterLinks);
    if (result !== true) return result;
  }

  return true;
}

export const serverBrandingIsValid = rule({ cache: "contextual" })(
  async (
    _parent: unknown,
    args: Record<string, unknown>,
    _context: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    const inputs: unknown[] = [];
    if (Array.isArray(args.input)) inputs.push(...args.input);
    if (args.update) inputs.push(args.update);

    for (const input of inputs) {
      const result = validateServerBrandingInput(input);
      if (result !== true) return result;
    }
    return true;
  }
);
