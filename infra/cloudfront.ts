import { transformedImageBucket } from "./bucket";
import { cloudfrontRewriteFunction, imageProcessorFunction } from "./function";
import { createResourceName } from "./utils";

const cloudfrontOAI = new aws.cloudfront.OriginAccessIdentity(
  createResourceName("CloudFrontOAI"),
);

const lambdaOAC = new aws.cloudfront.OriginAccessControl(
  createResourceName("OriginAccessControl"),
  {
    name: `${$app.name}-${$app.stage}-${createResourceName("OriginAccessControl")}`,
    originAccessControlOriginType: "lambda",
    signingBehavior: "always",
    signingProtocol: "sigv4",
  },
);

const cloudfrontResponseHeadersPolicy =
  new aws.cloudfront.ResponseHeadersPolicy(
    createResourceName("ResponseHeadersPolicy"),
    {
      name: `${$app.name}-${$app.stage}-${createResourceName("ResponseHeadersPolicy")}`,
      customHeadersConfig: {
        items: [
          {
            header: "x-aws-image-optimization",
            value: "v1.0",
            override: true,
          },
          { header: "vary", value: "accept", override: true },
        ],
      },

      corsConfig: {
        accessControlAllowCredentials: false,
        accessControlAllowHeaders: {
          items: ["*"],
        },
        accessControlAllowMethods: {
          items: ["GET"],
        },
        accessControlAllowOrigins: {
          items: ["*"],
        },
        accessControlMaxAgeSec: 600,
        originOverride: false,
      },
    },
  );

const cachePolicy = new aws.cloudfront.CachePolicy(
  createResourceName("CachePolicy"),
  {
    name: `${$app.name}-${$app.stage}-${createResourceName("CachePolicy")}`,
    defaultTtl: 86400,
    maxTtl: 31536000,
    minTtl: 0,
    parametersInCacheKeyAndForwardedToOrigin: {
      cookiesConfig: {
        cookieBehavior: "none",
      },
      headersConfig: {
        headerBehavior: "none",
      },
      queryStringsConfig: {
        queryStringBehavior: "none",
      },
    },
  },
);

const groupOriginId = `${$app.name}-${$app.stage}-${createResourceName("GroupOrigin")}`;
const primaryOriginId = `${$app.name}-${$app.stage}-${createResourceName("PrimaryOrigin")}`;
const secondaryOriginId = `${$app.name}-${$app.stage}-${createResourceName("SecondaryOrigin")}`;

const s3Distribution = new sst.aws.Cdn(
  createResourceName("ImageDistribution"),
  {
    originGroups: [
      {
        originId: groupOriginId,
        failoverCriteria: {
          statusCodes: [403, 500, 503, 504],
        },
        members: [
          {
            originId: primaryOriginId,
          },
          {
            originId: secondaryOriginId,
          },
        ],
      },
    ],
    origins: [
      {
        originId: primaryOriginId,
        domainName: imageProcessorFunction.url.apply(
          (url) => new URL(url).hostname,
        ),
        originAccessControlId: lambdaOAC.id,
        customOriginConfig: {
          originProtocolPolicy: "https-only",
          httpPort: 443,
          httpsPort: 443,
          originSslProtocols: ["TLSv1.2"],
        },
      },

      {
        originId: secondaryOriginId,
        domainName:
          transformedImageBucket.nodes.bucket.bucketRegionalDomainName,
        s3OriginConfig: {
          originAccessIdentity: cloudfrontOAI.cloudfrontAccessIdentityPath,
        },
      },
    ],
    defaultCacheBehavior: {
      cachePolicyId: cachePolicy.id,
      allowedMethods: ["GET", "HEAD"],
      cachedMethods: ["GET", "HEAD"],
      targetOriginId: groupOriginId,
      viewerProtocolPolicy: "redirect-to-https",
      functionAssociations: [
        {
          eventType: "viewer-request",
          functionArn: cloudfrontRewriteFunction.arn,
        },
      ],
      responseHeadersPolicyId: cloudfrontResponseHeadersPolicy.id,
    },
  },
);

new aws.lambda.Permission("AllowCloudFrontServicePrincipal", {
  action: "lambda:InvokeFunctionUrl",
  function: imageProcessorFunction.arn,
  principal: "cloudfront.amazonaws.com",
  statementId: "AllowCloudFrontServicePrincipal",
  sourceArn: s3Distribution.nodes.distribution.arn,
});
