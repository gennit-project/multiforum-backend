import type { Record as Neo4jRecord } from 'neo4j-driver';
import type { ContentChannelsRow, ChannelNameRow, CommentChannelReferencesRow } from '../../customResolvers/contracts/contentChannelSource.js';
import type { ContentChannelLookup, IssueChannelLookup } from '../../services/persistence/contentChannelPermissionRepository.js';
declare const native: Neo4jRecord<CommentChannelReferencesRow>;
// @ts-expect-error a misspelled or unselected native query column is not available
native.get('channelUniqueName');
declare const source: ContentChannelsRow;
// @ts-expect-error native stored channel names are not yet normalized strings
const names: string[] = source.channelUniqueNames;
declare const single: ChannelNameRow;
// @ts-expect-error a raw channel property cannot be consumed as a normalized name
const name: string | null = single.channelUniqueName;
declare const normalized: ContentChannelLookup;
declare const normalizedSingle: IssueChannelLookup;
const safeNames: string[] = normalized.channelUniqueNames;
const safeName: string | null = normalizedSingle.channelUniqueName;
void [names,name,safeNames,safeName];
