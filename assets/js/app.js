/**
 * Shared Utilities and Render Engine
 */

const Utils = {
    generateId: () => '_' + Math.random().toString(36).substr(2, 9),
    
    // Pixel to MM conversion (approximate for screen, exact for PDF needs calibration)
    // 96 DPI is standard for screen
    mmToPx: (mm) => (mm * 96) / 25.4,
    pxToMm: (px) => (px * 25.4) / 96,

    storage: {
        save: (key, data) => localStorage.setItem(key, JSON.stringify(data)),
        get: (key) => {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        }
    },

    file: {
        downloadJson: (data, filename) => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", filename);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        },
        readJson: (file, callback) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    callback(json);
                } catch (error) {
                    console.error("Error parsing JSON", error);
                    alert("Invalid JSON file");
                }
            };
            reader.readAsText(file);
        }
    },

    // Compression & Encoding
    compressImage: (file, maxWidth = 1000, quality = 0.8) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let w = img.width;
                    let h = img.height;
                    
                    // Maintain aspect ratio
                    if (w > maxWidth || h > maxWidth) {
                        if (w > h) {
                            h = Math.round(h * (maxWidth / w));
                            w = maxWidth;
                        } else {
                            w = Math.round(w * (maxWidth / h));
                            h = maxWidth;
                        }
                    }

                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    
                    // Export as WebP or JPEG
                    const dataUrl = canvas.toDataURL('image/webp', quality);
                    resolve({ dataUrl, size: dataUrl.length });
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    },

    encodeTemplate: (template) => {
        const str = JSON.stringify(template);
        // LZString compressToEncodedURIComponent is URL safe
        return LZString.compressToEncodedURIComponent(str);
    },

    decodeTemplate: (encoded) => {
        try {
            const str = LZString.decompressFromEncodedURIComponent(encoded);
            return json = JSON.parse(str);
        } catch (e) {
            console.error("Decoding failed", e);
            return null;
        }
    }
};

const RenderEngine = {
    // Main render function
    render: async (canvas, template, formData) => {
        if (!canvas || !template) return;
        const ctx = canvas.getContext('2d');
        
        // Scale factor for high DPI (simulated retina for preview, higher for export)
        const scale = 2; // Preview scale
        const widthPx = Utils.mmToPx(template.meta.widthMm || 54) * scale;
        const heightPx = Utils.mmToPx(template.meta.heightMm || 86) * scale;

        // Resize canvas logic (ensures crisp rendering)
        if (canvas.width !== widthPx || canvas.height !== heightPx) {
            canvas.width = widthPx;
            canvas.height = heightPx;
            canvas.style.width = widthPx / scale + 'px';
            canvas.style.height = heightPx / scale + 'px';
        }


        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(scale, scale); // Apply global scale so coordinates work in "screen pixels" (approx 96 DPI base)

        // Draw Background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, Utils.mmToPx(template.meta.widthMm), Utils.mmToPx(template.meta.heightMm));

        // Draw Template Background (Schema V2)
        if (template.background && template.background.value) {
             try {
                const bgImg = await RenderEngine.loadImage(template.background.value);
                const fit = template.background.fit || 'stretch'; // default behavior

                if (fit === 'stretch') {
                     ctx.drawImage(bgImg, 0, 0, Utils.mmToPx(template.meta.widthMm || 54), Utils.mmToPx(template.meta.heightMm || 86));
                } else {
                     RenderEngine.drawImageProp(ctx, bgImg, 0, 0, Utils.mmToPx(template.meta.widthMm || 54), Utils.mmToPx(template.meta.heightMm || 86), 0.5, 0.5, 1, fit);
                }
            } catch (e) {
                console.error("Failed to load background image", e);
            }
        }
        // Legacy Support (Backward Compatibility)
        else if (template.meta.backgroundImage) {
            try {
                const bgImg = await RenderEngine.loadImage(template.meta.backgroundImage);
                ctx.drawImage(bgImg, 0, 0, Utils.mmToPx(template.meta.widthMm || 54), Utils.mmToPx(template.meta.heightMm || 86));
            } catch (e) {
                console.warn("Failed to load background image", e);
            }
        }

        // Sort layers by zIndex
        const layers = [...(template.layers || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

        for (const layer of layers) {
            await RenderEngine.drawLayer(ctx, layer, formData, template);
        }

        ctx.restore();
    },

    drawLayer: async (ctx, layer, formData, template) => {
        ctx.save();

        // Common layer properties
        const x = layer.x;
        const y = layer.y;
        const w = layer.w;
        const h = layer.h;

        if (layer.type === 'shape') {
            ctx.fillStyle = layer.fill || '#cccccc';
            if (layer.shapeType === 'rect') {
                ctx.fillRect(x, y, w, h);
            } else if (layer.shapeType === 'circle') {
                ctx.beginPath();
                ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
                ctx.fill();
            }
        } 
        else if (layer.type === 'text') {
            let text = (layer.staticText || 'Sample Text');
            let val = null;
            if (layer.bindKey && formData && formData[layer.bindKey]) {
                val = formData[layer.bindKey];
                if (val && typeof val === 'object' && val.value) {
                    val = val.value;
                }
                text = (layer.textPrefix || '') + String(val);
            } else if (layer.bindKey && formData && formData[layer.bindKey] === undefined) {
                // If bindKey exists but no data, show bindKey as placeholder
                text = layer.bindKey;
            }
            
            ctx.font = `${layer.fontWeight || 'normal'} ${layer.fontSize || 16}px ${layer.fontFamily || 'Arial'}`;
            ctx.fillStyle = layer.color || '#000000';
            ctx.textBaseline = 'top'; // Easier positioning
            
            let textX = x;
            if (layer.align === 'center') textX += w / 2;
            if (layer.align === 'right') textX += w;
            
            ctx.textAlign = layer.align || 'left';
            
            // Simple text wrapping could go here if needed, for now just truncate or overflow
            // For single line texts:
            ctx.fillText(text, textX, y, w); // optional max width
        }
        else if (layer.type === 'image') {
            // Determine image source
            let imgSrc = null;
            let imgProps = { x: 0.5, y: 0.5, zoom: 1 }; // Default center, no zoom
            let objectFit = layer.objectFit || 'cover'; // Defaulting to 'cover' for photos

            if (layer.bindKey && formData && formData[layer.bindKey]) {
                let val = formData[layer.bindKey];
                if (val && typeof val === 'object' && val.value) {
                    imgSrc = val.value;
                    imgProps = { ...imgProps, ...val.props };
                } else {
                    imgSrc = val;
                }
            } else if (layer.staticSrc) {
                imgSrc = layer.staticSrc;
            }

            if (imgSrc) {
                try {
                    const img = await RenderEngine.loadImage(imgSrc);
                    
                    // Handling clipping (rounded, circle)
                    if (layer.borderRadius || layer.shapeType === 'circle') {
                        ctx.beginPath();
                        if (layer.shapeType === 'circle') {
                             ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
                        } else {
                            // Rounded rect
                             ctx.roundRect(x, y, w, h, layer.borderRadius || 0);
                        }
                        ctx.clip();
                    }

                    RenderEngine.drawImageProp(ctx, img, x, y, w, h, imgProps.x, imgProps.y, imgProps.zoom, objectFit);

                } catch (e) {
                    console.warn(`Failed to load image for layer ${layer.id}`, e);
                    ctx.fillStyle = '#e2e8f0';
                    ctx.fillRect(x, y, w, h);
                    ctx.fillStyle = '#94a3b8';
                    ctx.font = '12px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('Image Error', x + w/2, y + h/2);
                }
            } else {
                // Placeholder
                ctx.fillStyle = '#e2e8f0';
                ctx.fillRect(x, y, w, h);
                ctx.fillStyle = '#94a3b8';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('Image', x + w/2, y + h/2);
            }
        }
        
        ctx.restore();
    },

    loadImage: (src) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            // Only set crossOrigin if not a data URI to avoid issues with local files or some browsers
            if (!src.startsWith('data:')) {
                img.crossOrigin = "Anonymous";
            }
            img.onload = () => resolve(img);
            img.onerror = (e) => {
                console.error("Image load error", src.substring(0, 50) + "...", e);
                reject(e);
            };
            img.src = src;
        });
    },

    // Helper to simulate object-fit: cover/contain in canvas
    // Source: https://stackoverflow.com/questions/21961839/simulation-background-size-cover-in-canvas
    drawImageProp: (ctx, img, x, y, w, h, offsetX, offsetY, zoom, fit = 'cover') => {
        if (typeof x === 'undefined') {
            x = y = 0;
            w = ctx.canvas.width;
            h = ctx.canvas.height;
        }

        // default offset is center
        offsetX = typeof offsetX === "number" ? offsetX : 0.5;
        offsetY = typeof offsetY === "number" ? offsetY : 0.5;
        zoom = typeof zoom === "number" ? zoom : 1;
        
        // keep bounds [0.0, 1.0]
        if (offsetX < 0) offsetX = 0;
        if (offsetY < 0) offsetY = 0;
        if (offsetX > 1) offsetX = 1;
        if (offsetY > 1) offsetY = 1;

        var iw = img.width,
            ih = img.height;

        // Calculate source rectangle (cropping)
        let sx, sy, sWidth, sHeight;
        
        // Target Aspect Ratio
        const targetRatio = w / h;
        // Image Aspect Ratio
        const imgRatio = iw / ih;

        if (fit === 'contain') {
             // Contain: source is entire image, dest is centered
             // NOT implemented here fully as this function expects filling the rect x,y,w,h
             // Usually contain means leaving empty space. 
             // For now let's focus on COVER which is what we use.
             sWidth = iw;
             sHeight = ih;
             sx = 0;
             sy = 0;
             // We would need to change dest coords for contain.
        } else {
            // COVER logic
            if (imgRatio > targetRatio) { 
                // Image is wider than target -> Crop width
                sHeight = ih;
                sWidth = ih * targetRatio;
                sy = 0;
                sx = (iw - sWidth) * offsetX; 
            } else { 
                // Image is taller -> Crop height
                sWidth = iw;
                sHeight = iw / targetRatio;
                sx = 0;
                sy = (ih - sHeight) * offsetY;
            }
        }
        
        // Apply Zoom: Shrink the source rectangle (zoom in)
        // Center of zoom is the center of current source rect
        const cx = sx + sWidth/2;
        const cy = sy + sHeight/2;
        
        sWidth /= zoom;
        sHeight /= zoom;
        
        sx = cx - sWidth/2;
        sy = cy - sHeight/2;

        ctx.drawImage(img, sx, sy, sWidth, sHeight, x, y, w, h);
    }
};
