import suspendUser from '../../customResolvers/mutations/suspendUser.js';
import suspendMod from '../../customResolvers/mutations/suspendMod.js';
import unsuspendUser from '../../customResolvers/mutations/unsuspendUser.js';
import unsuspendMod from '../../customResolvers/mutations/unsuspendMod.js';
import type {ModerationSuspensionMutationResolvers} from '../../customResolvers/contracts/moderationSuspensions.js';
import type {SuspensionWriteRepository} from '../../services/persistence/suspensionWriteRepository.js';
const contracts={suspendUser:suspendUser({}),suspendMod:suspendMod(),unsuspendUser:unsuspendUser(),unsuspendMod:unsuspendMod()} satisfies ModerationSuspensionMutationResolvers;
declare const row:Awaited<ReturnType<SuspensionWriteRepository['closeSuspensionIssue']>>['issues'][number];
const open:boolean=row.isOpen;
// @ts-expect-error raw persisted issueNumber is not promised by the write
const number:number=row.issueNumber;
// @ts-expect-error the raw node does not fetch the activity feed relationship
const feed:{id:string}[]=row.ActivityFeed;
// @ts-expect-error generated selected Boolean cannot be a string
const invalid:ModerationSuspensionMutationResolvers['suspendUser']=async()=>({id:'i',isOpen:'false'});
void [contracts,open,number,feed,invalid];
