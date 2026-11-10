import undo from '../../customResolvers/mutations/undoSuperUpvote.js';
import type {Driver} from 'neo4j-driver';
import type {UndoSuperVoteSource} from '../../customResolvers/contracts/moderationUndo.js';
declare const driver:Driver;
const actual=undo({driver}) satisfies UndoSuperVoteSource;
type Result=Awaited<ReturnType<typeof actual>>;
declare const result:Result;
// @ts-expect-error raw stored voter names are not completed strings
const name:string=result.superUpvotedByUsers[0].username;
// @ts-expect-error a fixed user map must include its selected key
const missing:Result={...result,superUpvotedByUsers:[{}]};
// @ts-expect-error primitive users cannot satisfy the fixed read projection
const primitive:Result={...result,superUpvotedByUsers:['person']};
// @ts-expect-error the fixed read selects no private User fields
const email=result.superUpvotedByUsers[0].Email;
void [actual,name,missing,primitive,email];
