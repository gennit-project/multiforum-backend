import type { PluginSettingsReadResolvers } from "../../customResolvers/contracts/pluginSettingsRead.js";
import installed from "../../customResolvers/queries/getInstalledPlugins.js";
import status from "../../customResolvers/queries/getPluginConfigStatus.js";
import type { Driver } from "neo4j-driver";
declare const driver: Driver;
const actual = { getInstalledPlugins: installed({driver}), getPluginConfigStatus: status({driver}) } satisfies PluginSettingsReadResolvers;
// @ts-expect-error fully-configured is Boolean
const invalidStatus: PluginSettingsReadResolvers["getPluginConfigStatus"] = () => ({ isFullyConfigured: "yes", fields: [] });
// @ts-expect-error generated scope accepts arbitrary nullable strings, cannot narrow to just server
const narrowScope: PluginSettingsReadResolvers["getPluginConfigStatus"] = (_p, _a: {pluginId:string;version:string;scope:"server"}) => ({isFullyConfigured:true,fields:[]});
// @ts-expect-error required installed version must be String
const badVersion: PluginSettingsReadResolvers["getInstalledPlugins"] = () => [{version:42}];
void [actual,invalidStatus,narrowScope,badVersion];
