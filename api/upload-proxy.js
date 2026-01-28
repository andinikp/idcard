
import { put } from '@vercel/blob';

export const config = {
  api: {
    bodyParser: false, // Disallow default body parsing for FormData
  },
};

export default async function handler(request, response) {
    if (request.method !== 'POST') return response.status(405).send('Method Not Allowed');

    // Auth Check REMOVED for ease of use
    // const authHeader = request.headers['authorization'];
    // if (!process.env.ADMIN_TOKEN || authHeader !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    //      return response.status(401).json({ error: 'Unauthorized' });
    // }

    try {
        // Basic stream handling for Vercel Functions (Edge/Node)
        // Since we disabled bodyParser, we need to parse multipart or just pipe the stream.
        // However, `put` accepts a request, a legible stream, or blob.
        // The simplest way without 'busboy' or similar heavy parsers in a pure function:
        // Use the `request` body if it's just the file binary (not FormData).
        // Let's adjust the client to send RAW BINARY (Blob) instead of FormData to make this trivial.

        const filename = request.query.filename || 'upload-' + Date.now() + '.jpg';
        
        const blob = await put(filename, request, {
            access: 'public',
        });

        return response.status(200).json(blob);

    } catch (error) {
        console.error(error);
        return response.status(500).json({ error: 'Upload failed' });
    }
}
