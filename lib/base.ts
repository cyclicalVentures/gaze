/** GitHub project pages use /gaze; local development and root deployments use /. */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const assetUrl = (path: string) => `${basePath}${path}`;
