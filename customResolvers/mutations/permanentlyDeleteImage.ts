import type { Driver } from "neo4j-driver";
import getStoredUploadDeleteResolver from "./permanentlyDeleteStoredUpload.js";

const permanentlyDeleteImage = ({ driver }: { driver: Driver }) =>
  getStoredUploadDeleteResolver({
    driver,
    mediaType: "Image",
  });

export default permanentlyDeleteImage;
