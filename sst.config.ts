/// <reference path="./.sst/platform/config.d.ts" />
import { readdirSync } from "node:fs";

/**
 * ## Router and bucket
 *
 * Creates a router that serves static files from the `public` folder of a given bucket.
 */
export default $config({
  app(input) {
    return {
      name: "aws-router-bucket",
      home: "aws",
      removal: input?.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    if (!process.env.NAME) {
      throw new Error("NAME environment variable is required");
    }

    const outputs = {};

    for (const value of readdirSync("./infra/")) {
      const result = await import("./infra/" + value);

      if (result.outputs) Object.assign(outputs, result.outputs);
    }
    return outputs;
  },
});
