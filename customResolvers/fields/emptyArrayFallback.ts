/**
 * Creates a field resolver that ensures array fields return [] instead of null.
 *
 * This fixes GraphQL errors where the schema defines a field as non-nullable array
 * (e.g., [User!]!) but the Neo4j OGM returns null when there are no relationships.
 *
 * For custom Cypher queries that pre-populate relationship data, this resolver
 * returns the pre-populated data directly, avoiding re-resolution by the OGM.
 *
 * @param fieldName - The name of the field on the parent object
 * @returns A resolver function that returns the field value or an empty array
 */
export default function emptyArrayFallback(fieldName: string) {
  return (parent: any) => {
    const value = parent?.[fieldName];

    // If the value is an array (even empty), return it directly
    // This ensures pre-populated data from Cypher queries is used
    if (Array.isArray(value)) {
      // Filter out null values that might come from Cypher COLLECT with CASE WHEN
      return value.filter((item: any) => item !== null);
    }

    // Fallback to empty array for null/undefined
    return [];
  };
}
