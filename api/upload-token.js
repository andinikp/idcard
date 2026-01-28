
import { handleUpload } from '@vercel/blob/client';

export default async function handler(request, response) {
  const body = JSON.parse(request.body);

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname /*, clientPayload */) => {
        // Auth Check REMOVED for ease of use
        // const authHeader = request.headers['authorization'];
        // if (!process.env.ADMIN_TOKEN || authHeader !== `Bearer ${process.env.ADMIN_TOKEN}`) {
        //      throw new Error('Unauthorized');
        // }
        
        // Limit uploads to images
        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
          tokenPayload: JSON.stringify({
             // optional payload
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Webhook successful upload feedback
        console.log('blob uploaded', blob.url);
      },
    });

    return response.status(200).json(jsonResponse);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
}
