import type {SiteWideDownloadFileFields} from '../contracts/siteWideDownloadFiles.js';
/** The sole owned parent producer uses canonical keys, including under aliases. */
export function siteWideDownloadableFiles(parent:{DownloadableFiles?:(SiteWideDownloadFileFields|null)[]|null}|null|undefined):SiteWideDownloadFileFields[] {
 const value=parent?.DownloadableFiles;
 return Array.isArray(value)?value.filter(item=>item!==null):[];
}
