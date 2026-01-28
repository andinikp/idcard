
import { put } from '@vercel/blob';

export default async function handler(request, response) {
    if (request.method !== 'POST') return response.status(405).send('Method Not Allowed');

    // Auth Check
    const authHeader = request.headers['authorization'];
    if (!process.env.ADMIN_TOKEN || authHeader !== `Bearer ${process.env.ADMIN_TOKEN}`) {
         return response.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { slug, template } = request.body;
        
        if (!slug || !template) {
            return response.status(400).json({ error: 'Missing slug or template data' });
        }

        const filename = `templates/${slug}.json`;
        const blob = await put(filename, JSON.stringify(template, null, 2), {
            access: 'public',
            contentType: 'application/json',
            addRandomSuffix: false // We use the slug as the unique identifier
        });

        return response.status(200).json({ 
            success: true, 
            slug: slug,
            url: blob.url 
        });

    } catch (error) {
        console.error(error);
        return response.status(500).json({ error: 'Failed to publish template' });
    }
}
