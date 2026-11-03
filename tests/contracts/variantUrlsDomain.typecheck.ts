import type { VariantUrlsDomain } from "../../customResolvers/contracts/variantUrlsDomain.js";
import { createVariantUrlsResolver } from "../../customResolvers/fields/variantUrls.js";
const resolver=createVariantUrlsResolver({avatar32:"avatar32Url"});
const output: VariantUrlsDomain=resolver({variantUrls:{invalid:42,valid:"url"}});
// @ts-expect-error non-string JSON values are not a valid normalized domain result
const invalid: VariantUrlsDomain={avatar32:42};
// @ts-expect-error nested objects are not a valid normalized URL map
const nested: VariantUrlsDomain={avatar32:{url:"image"}};
void [output,invalid,nested];
