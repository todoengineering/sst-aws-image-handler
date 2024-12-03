import { createResourceName } from "./utils";

const originalImagebucket = new sst.aws.Bucket(createResourceName("Original"));

const transformedImageBucket = new sst.aws.Bucket(
  createResourceName("Transformed"),
);

export { originalImagebucket, transformedImageBucket };
