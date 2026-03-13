import { generateDefaultOGImage } from "@/keeperhub/api/og/generate-og";

export async function GET(): Promise<Response> {
  return await generateDefaultOGImage();
}
