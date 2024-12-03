type ImageOperation = {
  format?: string;
  width?: string;
  height?: string;
  quality?: string;
};

type CloudFrontRequest = {
  uri: string;
  querystring: Record<string, { value: string }>;
  headers: Record<string, { value: string }>;
};

type CloudFrontEvent = {
  request: CloudFrontRequest;
};

const SUPPORTED_FORMATS = [
  "auto",
  "jpeg",
  "webp",
  "avif",
  "png",
  "svg",
  "gif",
] as const;
type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

const MAX_DIMENSION = 4000;
const MAX_QUALITY = 100;

const isValidFormat = (format: string): format is SupportedFormat =>
  SUPPORTED_FORMATS.includes(format.toLowerCase() as SupportedFormat);

const determineFormat = (
  requestedFormat: string,
  acceptHeader?: string,
): SupportedFormat => {
  const format = requestedFormat.toLowerCase();
  if (format !== "auto") return format as SupportedFormat;

  if (acceptHeader) {
    if (acceptHeader.includes("avif")) return "avif";
    if (acceptHeader.includes("webp")) return "webp";
  }
  return "jpeg";
};

const parseNumberParam = (value: string, max?: number): string | undefined => {
  const parsed = parseInt(value, 10);

  if (isNaN(parsed) || parsed <= 0) {
    return undefined;
  }

  if (!max) {
    return parsed.toString();
  }

  return Math.min(parsed, max).toString();
};

const processOperation = (
  operation: string,
  value: string,
  acceptHeader?: string,
): Partial<ImageOperation> => {
  switch (operation.toLowerCase()) {
    case "format":
      if (isValidFormat(value)) {
        return { format: determineFormat(value, acceptHeader) };
      }

      return {};
    case "width":
      return { width: parseNumberParam(value, MAX_DIMENSION) };
    case "height":
      return { height: parseNumberParam(value, MAX_DIMENSION) };
    case "quality":
      return { quality: parseNumberParam(value, MAX_QUALITY) };
    default:
      return {};
  }
};

const buildOperationPath = (operations: ImageOperation): string => {
  const params: string[] = [];

  if (operations.format) {
    params.push(`format=${operations.format}`);
  }
  if (operations.quality) {
    params.push(`quality=${operations.quality}`);
  }
  if (operations.width) {
    params.push(`width=${operations.width}`);
  }
  if (operations.height) {
    params.push(`height=${operations.height}`);
  }

  return params.length > 0 ? `/${params.join(",")}` : "/original";
};

function handler(event: CloudFrontEvent): CloudFrontRequest {
  const request = event.request;
  const originalUri = request.uri;
  const acceptHeader = request.headers["accept"]?.value;

  if (!request.querystring) {
    request.uri = `${originalUri}/original`;
    request.querystring = {};
    return request;
  }

  const operations: ImageOperation = {};

  for (const [operation, { value }] of Object.entries(request.querystring)) {
    const result = processOperation(operation, value, acceptHeader);
    Object.assign(operations, result);
  }

  request.uri = `${originalUri}${buildOperationPath(operations)}`;
  request.querystring = {};

  return request;
}
