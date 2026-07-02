import type { Driver } from "neo4j-driver";
import getUrlBackedImageDeleteResolver from "./permanentlyDeleteUrlBackedImage.js";

const permanentlyDeleteChannelBanner = ({ driver }: { driver: Driver }) =>
  getUrlBackedImageDeleteResolver({
    driver,
    referenceType: "ChannelBanner",
  });

export default permanentlyDeleteChannelBanner;
