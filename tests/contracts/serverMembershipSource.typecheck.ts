import type {ServerMembershipConfig,ServerMembershipWriteResult} from '../../customResolvers/contracts/serverMembershipSource.js';
import {serverMembershipConfig} from '../helpers/serverMembershipSource.js';
const value=serverMembershipConfig();
const complete:ServerMembershipWriteResult={serverConfigs:[value]};
// @ts-expect-error every selected nullable key is still required
const absent:ServerMembershipWriteResult={serverConfigs:[{serverName:'cats'}]};
// @ts-expect-error completed integers cannot be text
const age:ServerMembershipConfig={...value,minimumAccountAge:'13'};
// @ts-expect-error non-null string elements cannot be null
const registries:ServerMembershipConfig={...value,pluginRegistries:[null]};
// @ts-expect-error public JSON has no asserted configuration shape
const pipelines:Record<string,string>=value.pluginPipelines;
// @ts-expect-error no moderator relationship is selected by the fixed write
const moderators=value.Moderators;
void [complete,absent,age,registries,pipelines,moderators];
