function createResourceName(suffix: string): string {
  return `${process.env.NAME}${suffix}`;
}

export { createResourceName };
