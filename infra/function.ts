import { fileURLToPath } from "node:url";
import fs from "fs";
import path from "path";

import { originalImagebucket, transformedImageBucket } from "./bucket";
import { createResourceName } from "./utils";

const imageProcessorFunction = new sst.aws.Function(
  createResourceName("ImageProcessor"),
  {
    handler: "src/image-processor.handler",
    nodejs: { install: ["sharp"] },
    memory: "1024 MB",
    timeout: "30 seconds",
    url: true,
    link: [originalImagebucket, transformedImageBucket],
    environment: {
      transformedImageCacheTTL:
        process.env.transformedImageCacheTTL ?? "max-age=31622400",
      maxImageSize: process.env.MAX_IMAGE_SIZE ?? "4700000",
      name: process.env.NAME as string,
    },
  },
);

const cloudfrontRewriteFunction = new aws.cloudfront.Function(
  createResourceName("RewriteFunction"),
  {
    name: `${$app.name}-${$app.stage}-${createResourceName("RewriteFunction")}`,
    publish: true,
    runtime: "cloudfront-js-2.0",
    code: fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../src/rewrite-url.js",
      ),
      "utf8",
    ),
  },
);

export { imageProcessorFunction, cloudfrontRewriteFunction };
