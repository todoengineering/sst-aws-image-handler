import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

import { originalImagebucket, transformedImageBucket } from "./bucket";
import { createResourceName } from "./utils";

const imageProcessorFunction = new sst.aws.Function(
  createResourceName("ImageProcessing"),
  {
    handler: "src/imageProcessing.handler",
    nodejs: { install: ["sharp"] },
    memory: "1024 MB",
    timeout: "30 seconds",
    url: true,
    link: [originalImagebucket, transformedImageBucket],
    environment: {
      transformedImageCacheTTL:
        process.env.transformedImageCacheTTL ?? "max-age=31622400",
      maxImageSize: process.env.MAX_IMAGE_SIZE ?? "4700000",
    },
  },
);

const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-function-"));
const outfile = path.join(outdir, "rewrite-url.js");

if (fs.existsSync(outdir)) {
  fs.rmSync(outdir, { recursive: true });
}

esbuild.buildSync({
  entryPoints: ["src/rewrite-url.ts"],
  bundle: true,
  minify: true,
  platform: "node",
  target: "es2020",
  outfile: outfile,
});

const cloudfrontRewriteFunction = new aws.cloudfront.Function(
  createResourceName("RewriteFunction"),
  {
    name: `${$app.name}-${$app.stage}-${createResourceName("RewriteFunction")}`,
    publish: true,
    runtime: "cloudfront-js-2.0",
    code: fs.readFileSync(outfile, "utf-8"),
  },
);

export { imageProcessorFunction, cloudfrontRewriteFunction };
