import type { Driver } from "neo4j-driver";
import getUrlBackedImageDeleteResolver from "./permanentlyDeleteUrlBackedImage.js";

const permanentlyDeleteProfileImage = ({ driver }: { driver: Driver }) =>
  getUrlBackedImageDeleteResolver({
    driver,
    referenceType: "ProfileImage",
  });

export default permanentlyDeleteProfileImage;
