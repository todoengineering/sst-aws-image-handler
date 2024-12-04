import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import Sharp from "sharp";
import { Resource } from "sst";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

// Types
type ImageFormat = "jpeg" | "gif" | "webp" | "png" | "avif";

interface ImageOperations {
  width?: number;
  height?: number;
  format?: ImageFormat;
  quality?: number;
}

interface ImageProcessingConfig {
  originalBucket: string;
  transformedBucket: string;
  cacheTTL: string;
  maxImageSize: number;
}

interface TimingMetrics {
  download: number;
  transform: number;
  upload?: number;
}

// Constants
const config: ImageProcessingConfig = {
  originalBucket: Resource[`${process.env.name}Original`].name,
  transformedBucket: Resource[`${process.env.name}Transformed`].name,
  cacheTTL: process.env.transformedImageCacheTTL || "max-age=31536000",
  maxImageSize: parseInt(process.env.maxImageSize || String(6 * 1024 * 1024)),
};

const s3Client = new S3Client();

// Helper functions
const parseImagePath = (
  path: string,
): { originalPath: string; operations: ImageOperations } => {
  const pathArray = path.split("/");
  const operationsString = pathArray.pop() || "";
  pathArray.shift();

  const operations = Object.fromEntries(
    operationsString.split(",").map((op) => op.split("=")),
  );

  return {
    originalPath: pathArray.join("/"),
    operations: {
      width: operations.width ? parseInt(operations.width) : undefined,
      height: operations.height ? parseInt(operations.height) : undefined,
      format: operations.format as ImageFormat | undefined,
      quality: operations.quality ? parseInt(operations.quality) : undefined,
    },
  };
};

const getContentType = (
  format: ImageFormat | undefined,
  originalType: string,
): string => {
  if (!format) {
    return originalType === "image/svg+xml" ? "image/png" : originalType;
  }

  const formatMap: Record<ImageFormat, string> = {
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    png: "image/png",
    avif: "image/avif",
  };

  return formatMap[format];
};

const formatTimingHeader = (metrics: TimingMetrics): string => {
  const timings = [
    `img-download;dur=${Math.round(metrics.download)}`,
    `img-transform;dur=${Math.round(metrics.transform)}`,
  ];

  if (metrics.upload !== undefined) {
    timings.push(`img-upload;dur=${Math.round(metrics.upload)}`);
  }

  return timings.join(",");
};

const createRedirectResponse = (
  path: string,
  operations: string,
  timingHeader: string,
): APIGatewayProxyResultV2 => ({
  statusCode: 302,
  headers: {
    Location: `/${path}?${operations.replace(/,/g, "&")}`,
    "Cache-Control": "private,no-store",
    "Server-Timing": timingHeader,
  },
});

const createSuccessResponse = (
  image: Buffer,
  contentType: string,
  timingHeader: string,
): APIGatewayProxyResultV2 => ({
  statusCode: 200,
  body: image.toString("base64"),
  isBase64Encoded: true,
  headers: {
    "Content-Type": contentType,
    "Cache-Control": config.cacheTTL,
    "Server-Timing": timingHeader,
  },
});

const createErrorResponse = (
  statusCode: number,
  message: string,
  error?: unknown,
): APIGatewayProxyResultV2 => {
  console.error("Application Error:", message, error);
  return {
    statusCode,
    body: JSON.stringify({ error: message }),
    headers: {
      "Content-Type": "application/json",
    },
  };
};

// Main handler
const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  // Validate request method
  if (event.requestContext?.http?.method !== "GET") {
    return createErrorResponse(400, "Only GET method is supported");
  }

  const { originalPath, operations } = parseImagePath(
    event.requestContext.http.path,
  );

  const metrics: TimingMetrics = {
    download: 0,
    transform: 0,
  };

  // Download original image
  const downloadStart = performance.now();
  let originalImage: Buffer;
  let contentType: string;

  try {
    const getCommand = new GetObjectCommand({
      Bucket: config.originalBucket,
      Key: originalPath,
    });
    const response = await s3Client.send(getCommand);

    originalImage = Buffer.from(await response.Body!.transformToByteArray());
    contentType = response.ContentType || "image/jpeg";
    metrics.download = performance.now() - downloadStart;
  } catch (error) {
    return createErrorResponse(500, "Error downloading original image", error);
  }

  // Transform image
  const transformStart = performance.now();
  let transformedImage: Buffer;

  try {
    let sharpInstance = Sharp(originalImage, {
      failOn: "none",
      animated: true,
    });

    const metadata = await sharpInstance.metadata();

    // Apply transformations
    if (operations.width || operations.height) {
      sharpInstance = sharpInstance.resize({
        width: operations.width,
        height: operations.height,
      });
    }

    if (metadata.orientation) {
      sharpInstance = sharpInstance.rotate();
    }

    if (operations.format) {
      const isLossy = ["jpeg", "webp", "avif"].includes(operations.format);

      if (isLossy && operations.quality) {
        sharpInstance = sharpInstance.toFormat(operations.format, {
          quality: operations.quality,
        });
      } else {
        sharpInstance = sharpInstance.toFormat(operations.format);
      }
    }

    transformedImage = await sharpInstance.toBuffer();
    metrics.transform = performance.now() - transformStart;

    contentType = getContentType(operations.format, contentType);
  } catch (error) {
    return createErrorResponse(500, "Error transforming image", error);
  }

  // Handle large images
  const isImageTooBig = transformedImage.byteLength > config.maxImageSize;

  // Upload transformed image if configured
  if (config.transformedBucket) {
    const uploadStart = performance.now();
    try {
      const putCommand = new PutObjectCommand({
        Body: transformedImage,
        Bucket: config.transformedBucket,
        Key: `${originalPath}/${Object.entries(operations)
          .map(([k, v]) => `${k}=${v}`)
          .join(",")}`,
        ContentType: contentType,
        CacheControl: config.cacheTTL,
      });

      await s3Client.send(putCommand);
      metrics.upload = performance.now() - uploadStart;

      if (isImageTooBig) {
        return createRedirectResponse(
          originalPath,
          Object.entries(operations)
            .map(([k, v]) => `${k}=${v}`)
            .join(","),
          formatTimingHeader(metrics),
        );
      }
    } catch (error) {
      console.error("Could not upload transformed image to S3:", error);
    }
  }

  if (isImageTooBig) {
    return createErrorResponse(403, "Requested transformed image is too big");
  }

  return createSuccessResponse(
    transformedImage,
    contentType,
    formatTimingHeader(metrics),
  );
};

export { handler };
