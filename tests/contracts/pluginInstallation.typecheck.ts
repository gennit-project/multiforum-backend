import type { Driver } from "neo4j-driver";
import type { PluginInstallationMutationResolvers } from "../../customResolvers/contracts/pluginInstallation.js";
import enableServerPlugin from "../../customResolvers/mutations/enableServerPlugin.js";
import installPluginVersion from "../../customResolvers/mutations/installPluginVersion.js";
import refreshPlugins from "../../customResolvers/mutations/refreshPlugins.js";
declare const driver: Driver;
const actual = {enableServerPlugin:enableServerPlugin({driver}),installPluginVersion:installPluginVersion({driver}),refreshPlugins:refreshPlugins({driver})} satisfies PluginInstallationMutationResolvers;
// @ts-expect-error required plugin identity is not optional
const missingIdentity:PluginInstallationMutationResolvers["refreshPlugins"] = () => [{name:"x",Versions:[]}];
// @ts-expect-error Boolean response cannot be a string
const wrongEnabled:PluginInstallationMutationResolvers["installPluginVersion"] = () => ({plugin:{id:"x",name:"x"},version:"1",scope:"SERVER",enabled:"false",settingsJson:null,carryOverReport:null});
// @ts-expect-error version identifier cannot be numeric
const wrongVersion:PluginInstallationMutationResolvers["refreshPlugins"] = () => [{id:"x",name:"x",Versions:[{id:"v",version:3}]}];
void [actual,missingIdentity,wrongEnabled,wrongVersion];
