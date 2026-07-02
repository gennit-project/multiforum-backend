import type { Driver } from "neo4j-driver";
import getStoredUploadDeleteResolver from "./permanentlyDeleteStoredUpload.js";

const permanentlyDeleteDownloadableFile = ({ driver }: { driver: Driver }) =>
  getStoredUploadDeleteResolver({
    driver,
    mediaType: "DownloadableFile",
  });

export default permanentlyDeleteDownloadableFile;
