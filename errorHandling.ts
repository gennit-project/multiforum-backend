/**
 * Enhanced GraphQL Error Handling
 * Provides comprehensive error logging and formatting for better debugging
 */

import { GraphQLError, GraphQLFormattedError } from 'graphql';
import type { SourceLocation } from 'graphql';

interface ErrorRequest {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  connection?: { remoteAddress?: string };
}

interface ErrorContext {
  req?: ErrorRequest;
  operationName?: string;
  variables?: Record<string, unknown>;
  query?: string;
}

interface EnhancedError extends Error {
  locations?: ReadonlyArray<SourceLocation>;
  path?: ReadonlyArray<string | number>;
  extensions?: {
    code?: string;
    exception?: unknown;
    [key: string]: unknown;
  };
  originalError?: Error;
}

/**
 * Enhanced error formatter that provides detailed logging and improved error responses
 */
export function formatGraphQLError(error: EnhancedError, context?: ErrorContext): GraphQLFormattedError {
  // Extract error details
  const {
    message,
    locations,
    path,
    extensions,
    originalError
  } = error;

  const errorCode = extensions?.code || 'UNKNOWN_ERROR';
  const timestamp = new Date().toISOString();

  // Create error ID for tracking
  const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Comprehensive error logging
  console.error('🚨 GraphQL Error Details:', {
    errorId,
    timestamp,
    message,
    code: errorCode,
    path,
    locations,
    operationName: context?.operationName,
    variables: context?.variables ? sanitizeVariables(context.variables) : undefined,
    query: context?.query ? truncateQuery(context.query) : undefined,
    userAgent: context?.req?.headers?.['user-agent'],
    ip: context?.req?.ip || context?.req?.connection?.remoteAddress,
    stack: originalError?.stack || error.stack,
    extensions: extensions?.exception ? {
      ...extensions,
      exception: sanitizeException(extensions.exception)
    } : extensions
  });

  // Log the full query for validation errors (most common debugging need)
  if (isValidationError(errorCode) && context?.query) {
    console.error('📝 Full Query that caused validation error:');
    console.error(context.query);
    if (context.variables) {
      console.error('📝 Variables:');
      console.error(JSON.stringify(context.variables, null, 2));
    }
  }

  // Enhanced error response based on environment
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  const formattedError: GraphQLFormattedError = {
    message: enhanceErrorMessage(message, errorCode),
    locations,
    path,
    extensions: {
      code: errorCode,
      errorId,
      timestamp,
      // Include more details in development
      ...(isDevelopment && {
        originalMessage: message,
        stack: originalError?.stack || error.stack,
        operationName: context?.operationName,
        variables: context?.variables ? sanitizeVariables(context.variables) : undefined
      })
    }
  };

  // Add specific debugging info for common error types
  if (isValidationError(errorCode)) {
    formattedError.extensions!.debugHint = 'Check if your query matches the current schema. Try running this query in GraphQL Playground to see detailed validation errors.';
  } else if (isAuthError(errorCode)) {
    formattedError.extensions!.debugHint = 'Authentication required. Check your auth headers and user session.';
  } else if (isPermissionError(errorCode)) {
    formattedError.extensions!.debugHint = 'Insufficient permissions for this operation. Check user roles and permissions.';
  }

  return formattedError;
}

/**
 * Enhanced error message based on error type
 */
function enhanceErrorMessage(originalMessage: string, errorCode: string): string {
  switch (errorCode) {
    case 'GRAPHQL_VALIDATION_FAILED':
      return `Schema Validation Error: ${originalMessage}. This usually means your query doesn't match the current GraphQL schema.`;
    case 'GRAPHQL_PARSE_FAILED':
      return `Query Parse Error: ${originalMessage}. Check your GraphQL syntax.`;
    case 'BAD_USER_INPUT':
      return `Invalid Input: ${originalMessage}. Check your query variables and arguments.`;
    case 'UNAUTHENTICATED':
      return `Authentication Required: ${originalMessage}`;
    case 'FORBIDDEN':
      return `Permission Denied: ${originalMessage}`;
    case 'INTERNAL_SERVER_ERROR':
      return `Internal Server Error: ${originalMessage}. Check server logs for more details.`;
    default:
      return originalMessage;
  }
}

/**
 * Check if error is a validation error
 */
function isValidationError(errorCode: string): boolean {
  return [
    'GRAPHQL_VALIDATION_FAILED',
    'GRAPHQL_PARSE_FAILED',
    'BAD_USER_INPUT'
  ].includes(errorCode);
}

/**
 * Check if error is an authentication error
 */
function isAuthError(errorCode: string): boolean {
  return ['UNAUTHENTICATED'].includes(errorCode);
}

/**
 * Check if error is a permission error
 */
function isPermissionError(errorCode: string): boolean {
  return ['FORBIDDEN'].includes(errorCode);
}

/**
 * Sanitize variables to remove sensitive information
 */
function sanitizeVariables(variables: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];
  const sanitized = { ...variables };
  
  Object.keys(sanitized).forEach(key => {
    if (sensitiveKeys.some(sensitiveKey => key.toLowerCase().includes(sensitiveKey))) {
      sanitized[key] = '[REDACTED]';
    }
  });
  
  return sanitized;
}

/**
 * Sanitize exception details
 */
function sanitizeException(exception: unknown): unknown {
  if (!exception) return exception;

  // Remove sensitive stack traces in production
  if (process.env.NODE_ENV === 'production') {
    return {
      ...(exception as Record<string, unknown>),
      stacktrace: '[REDACTED IN PRODUCTION]'
    };
  }

  return exception;
}

/**
 * Truncate query for logging to avoid excessive log size
 */
function truncateQuery(query: string, maxLength: number = 1000): string {
  if (query.length <= maxLength) return query;
  return query.substring(0, maxLength) + '... [TRUNCATED]';
}

/**
 * Log critical errors for monitoring
 */
export function logCriticalError(error: Error, context?: Record<string, unknown>): void {
  console.error('🔥 CRITICAL ERROR:', {
    timestamp: new Date().toISOString(),
    message: error.message,
    stack: error.stack,
    context
  });
  
  // In production, you might want to send this to external monitoring
  // services like Sentry, DataDog, or CloudWatch
}

/**
 * Plugin for Apollo Server to enhance error handling
 */
interface ErrorHandlingRequestContext {
  request: {
    operationName?: string;
    variables?: Record<string, unknown>;
    query?: string;
    http?: { req?: ErrorRequest };
  };
  errors: ReadonlyArray<EnhancedError>;
  contextValue?: { user?: { id?: string } };
}

export const errorHandlingPlugin = {
  requestDidStart() {
    return Promise.resolve({
      async didEncounterErrors(requestContext: ErrorHandlingRequestContext) {
        const { request, errors } = requestContext;

        errors.forEach((error: EnhancedError) => {
          // Format error with context
          formatGraphQLError(error, {
            req: requestContext.request.http?.req,
            operationName: request.operationName,
            variables: request.variables,
            query: request.query
          });
          
          // Log critical errors for monitoring
          if (isCriticalError(error)) {
            logCriticalError(error, {
              operationName: request.operationName,
              variables: request.variables,
              userId: requestContext.contextValue?.user?.id
            });
          }
        });
      }
    });
  }
};

/**
 * Determine if an error is critical and needs immediate attention
 */
function isCriticalError(error: EnhancedError): boolean {
  const criticalCodes = [
    'INTERNAL_SERVER_ERROR',
    'DATABASE_CONNECTION_ERROR',
    'EXTERNAL_SERVICE_ERROR'
  ];
  
  return criticalCodes.includes(error.extensions?.code || '') ||
         error.message.includes('Cannot connect to database') ||
         error.message.includes('Service unavailable');
}