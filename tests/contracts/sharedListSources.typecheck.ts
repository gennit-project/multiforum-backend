import type {GeneratedListSource} from '../helpers/sharedListSources.js';
const valid:GeneratedListSource={parent:'Channel',root:'channels',key:'uniqueName',field:'Tags'};
// @ts-expect-error scalar fields do not qualify as list-source probes
const scalar:GeneratedListSource={parent:'Channel',root:'channels',key:'uniqueName',field:'uniqueName'};
// @ts-expect-error root source and schema parent must agree
const root:GeneratedListSource={parent:'Channel',root:'albums',key:'uniqueName',field:'Tags'};
// @ts-expect-error list fields must exist on their declared parent
const field:GeneratedListSource={parent:'Album',root:'albums',key:'id',field:'Tags'};
void [valid,scalar,root,field];
// @ts-expect-error unrestricted JSON is not a statically known list
const json:GeneratedListSource={parent:'Channel',root:'channels',key:'uniqueName',field:'variantUrls'};
void json;
