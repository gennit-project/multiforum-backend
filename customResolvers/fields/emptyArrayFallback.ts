/**
 * Creates a field resolver that ensures array fields return [] instead of null.
 *
 * This fixes GraphQL errors where the schema defines a field as non-nullable array
 * (e.g., [User!]!) but the Neo4j OGM returns null when there are no relationships.
 *
 * @param fieldName - The name of the field on the parent object
 * @returns A resolver function that returns the field value or an empty array
 */
export default function emptyArrayFallback(fieldName: string) {
  return (parent: any) => {
    return parent[fieldName] || [];
  };
}
