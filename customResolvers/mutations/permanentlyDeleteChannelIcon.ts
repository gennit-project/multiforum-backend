import type { Driver } from "neo4j-driver";
import getUrlBackedImageDeleteResolver from "./permanentlyDeleteUrlBackedImage.js";

const permanentlyDeleteChannelIcon = ({ driver }: { driver: Driver }) =>
  getUrlBackedImageDeleteResolver({
    driver,
    referenceType: "ChannelIcon",
  });

export default permanentlyDeleteChannelIcon;
