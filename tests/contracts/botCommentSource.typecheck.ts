import type {BotCommentCreatedSource} from '../../customResolvers/contracts/botCommentSource.js';
import type {Comment} from '../../src/generated/graphql.js';
import type {Projection} from '../../customResolvers/contracts/selection.js';
declare const source:BotCommentCreatedSource;
const identity:Projection<Comment,{id:true}>=source;
// @ts-expect-error raw caller text is not certified by the owned write
const text:string=source.text;
// @ts-expect-error owned scalar snapshot is not an entire GraphQL Comment
const full:Comment=source;
// @ts-expect-error the CREATE source must include its generated identity
const missing:BotCommentCreatedSource={text:'comment'};
void [identity,text,full,missing];
