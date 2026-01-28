
import { list } from '@vercel/blob';

// Since we are using random suffix = false in publish, we *could* guess the URL if we knew the blob store URL structure, 
// but retrieving via list or just knowing the base URL is safer. 
// However, the cleanest way if we want to serve it via API is to redirect to the Blob URL or fetch and return.
// Better: We stored the Blob URL in the publish step, but the client only has the slug.
// We need to find the file `templates/<slug>.json`.

export default async function handler(request, response) {
    const { slug } = request.query;

    if (!slug) return response.status(400).json({ error: 'Slug required' });

    try {
        // List blobs with prefix 'templates/'
        console.log(`Searching for template: templates/${slug}.json`);
        
        // Note: list() returns latest blobs. 
        const { blobs } = await list({ 
            prefix: `templates/${slug}.json`,
            limit: 1 
        });

        if (blobs.length === 0) {
            return response.status(404).json({ error: 'Template not found' });
        }

        // Redirect to the blob URL (faster than proxying)
        // Client will fetch this JSON
        return response.redirect(302, blobs[0].url);

    } catch (error) {
        console.error(error);
        return response.status(500).json({ error: 'Internal Server Error' });
    }
}
