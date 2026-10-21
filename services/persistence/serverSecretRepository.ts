import type { Driver } from "neo4j-driver";
import type { ServerSecret } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

// Preserve the OGM default scalar projection, including unused non-null fields.
export const SERVER_SECRET_DEFAULT_SELECTION = `{ id pluginId key ciphertext isValid validationError lastValidatedAt updatedAt createdAt }`;
const LOOKUP = `query ServerSecretForReplacement($where: ServerSecretWhere) { serverSecrets(where: $where) ${SERVER_SECRET_DEFAULT_SELECTION} }`;
const REPLACE = `mutation ReplaceServerSecret($where: ServerSecretWhere, $update: ServerSecretUpdateInput) { updateServerSecrets(where: $where, update: $update) { serverSecrets ${SERVER_SECRET_DEFAULT_SELECTION} } }`;
const CREATE = `mutation CreateServerPluginSecret($input: [ServerSecretCreateInput!]!) { createServerSecrets(input: $input) { serverSecrets ${SERVER_SECRET_DEFAULT_SELECTION} } }`;
const RENAME_CANDIDATES = `query ServerSecretRenameCandidates($where: ServerSecretWhere) { serverSecrets(where: $where) { id key } }`;
const RENAME = `mutation RenameServerPluginSecret($where: ServerSecretWhere, $update: ServerSecretUpdateInput) { updateServerSecrets(where: $where, update: $update) { serverSecrets ${SERVER_SECRET_DEFAULT_SELECTION} } }`;
export interface ServerSecretRepository {
  findForReplacement(pluginId: string, key: string): Promise<ServerSecret[]>;
  replaceCiphertext(id: string, ciphertext: string): Promise<void>;
  createEncryptedSecret(pluginId: string, key: string, ciphertext: string, updatedAt: string): Promise<void>;
  findRenameCandidates(pluginId: string): Promise<Array<{id: string; key: string}>>;
  renameKey(id: string, key: string): Promise<void>;
}
export function createServerSecretRepository(driver: Driver): ServerSecretRepository {
  return {
    async findForReplacement(pluginId, key) {
      const data = await executeGeneratedOperation<{serverSecrets: ServerSecret[]}>(driver, LOOKUP, {where:{AND:[{pluginId},{key}]}});
      return data.serverSecrets;
    },
    async replaceCiphertext(id, ciphertext) {
      await executeGeneratedOperation(driver, REPLACE, {where:{id},update:{ciphertext,isValid:false,lastValidatedAt:null,validationError:null}});
    },
    async createEncryptedSecret(pluginId, key, ciphertext, updatedAt) {
      await executeGeneratedOperation(driver, CREATE, {input:[{pluginId,key,ciphertext,isValid:false,updatedAt}]});
    },
    async findRenameCandidates(pluginId) {
      const data=await executeGeneratedOperation<{serverSecrets:Array<{id:string;key:string}>}>(driver, RENAME_CANDIDATES, {where:{pluginId}});
      return data.serverSecrets;
    },
    async renameKey(id, key) {
      await executeGeneratedOperation(driver, RENAME, {where:{id},update:{key}});
    },
  };
}
