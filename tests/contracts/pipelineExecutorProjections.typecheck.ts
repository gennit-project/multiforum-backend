import type {ChannelExecutionChannel,ChannelExecutionDiscussion,CommentExecutionComment,CreatedExecutionRuns,ExecutionConfiguration,ExecutionReturnedRun} from '../../customResolvers/contracts/pipelineExecutorProjections.js';
import type {Channel,Discussion} from '../../src/generated/graphql.js';
declare const channel:ChannelExecutionChannel;
// @ts-expect-error fixed selection is not the full channel entity
const fullChannel:Channel=channel;
// @ts-expect-error no unselected owner relationship
void channel.Admins;
declare const discussion:ChannelExecutionDiscussion;
// @ts-expect-error current query selects plural files, not legacy singular attachment
void discussion.DownloadableFile;
// @ts-expect-error author relationship remains nullable
void discussion.Author.username;
// @ts-expect-error fixed selection is not the full discussion entity
const fullDiscussion:Discussion=discussion;
declare const comment:CommentExecutionComment;
// @ts-expect-error neither author branch selects a discriminator
void comment.CommentAuthor?.__typename;
// @ts-expect-error moderator author cannot guarantee a direct username
const author:string=comment.CommentAuthor!.username;
declare const created:CreatedExecutionRuns;
// @ts-expect-error creation document does not select mutation info
void created.info;
declare const configuration:ExecutionConfiguration;
// @ts-expect-error scalar properties cannot replace selected connection edges
const invalid:ExecutionConfiguration={...configuration,InstalledVersionsConnection:{edges:[{node:{id:'version'}}]}};
declare const returned:ExecutionReturnedRun;
// @ts-expect-error returned run deliberately does not select lease data
void returned.leaseId;
void [fullChannel,fullDiscussion,author,invalid];
