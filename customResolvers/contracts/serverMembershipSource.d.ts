import type {ServerConfig} from '../../src/generated/graphql.js';
import type {serverMembershipSelection} from './serverMembershipSelection.js';
type SelectedFields=Required<Pick<ServerConfig,keyof typeof serverMembershipSelection>>;
/** Completed selected keys; public JSON remains unrestricted. */
export type ServerMembershipConfig=Omit<SelectedFields,'rules'|'brandingCustomFooterLinks'|'pluginPipelines'> & {
 rules:unknown;brandingCustomFooterLinks:unknown;pluginPipelines:unknown;
};
export type ServerMembershipWriteResult={serverConfigs:ServerMembershipConfig[]};
