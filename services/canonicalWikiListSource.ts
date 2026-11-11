import type {WikiListItemSource} from '../customResolvers/contracts/wikiCountProjections.js';
import {rememberCanonicalSource} from './canonicalSourceFields.js';
import {rememberAccountChildIdentity} from './accountChildIdentity.js';
/** Only the two owned wiki-list queries emit these exact canonical maps. */
export function canonicalWikiListSource(source:WikiListItemSource):WikiListItemSource {
 rememberCanonicalSource(source);
 if(source.VersionAuthor){
  rememberCanonicalSource(source.VersionAuthor);
  rememberAccountChildIdentity(source.VersionAuthor,source.VersionAuthor.username);
 }
 return source;
}
