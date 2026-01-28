/**
 * Generator Logic
 */

const Generator = {
    state: {
        template: null,
        formData: {},
        activeImageKey: null,
        dragStart: null // { x, y, origProps }
    },

    init: async () => {
        // Check for Shared Link (t param)
        const params = new URLSearchParams(window.location.search);
        const encoded = params.get('t');
        
        if (encoded) {
             console.log("Loading shared template...");
             const decoded = Utils.decodeTemplate(encoded);
             if (decoded) {
                 Generator.state.template = decoded;
             } else {
                 alert("Invalid or broken link.");
             }
        }
        
        // Fallback to local or default if link failed
        if (!Generator.state.template) {
            // Try local v2 first
             const local = Utils.storage.get('idcard_template_v2');
             if (local) {
                 Generator.state.template = local;
             } else {
                 try {
                    const def = await fetch('templates/default.json').then(r => r.json());
                    Generator.state.template = def;
                 } catch(e) { console.error(e); }
             }
        }

        if (!Generator.state.template) {
             alert('No template found. Please create one in the Designer (admin.html).');
             return;
        }

        Generator.renderForm();
        Generator.renderCanvas();
        Generator.bindEvents();
    },

    bindEvents: () => {
        document.getElementById('btnDownloadPNG').addEventListener('click', Generator.downloadPNG);
        document.getElementById('btnDownloadPDF').addEventListener('click', Generator.downloadPDF);
        document.getElementById('btnClear').addEventListener('click', () => {
             document.getElementById('generatorForm').reset();
             Generator.state.formData = {};
             Generator.renderCanvas();
        });
        
        // Canvas Interactions (Pan/Zoom)
        const canvas = document.getElementById('genCanvas');
        
        canvas.addEventListener('mousedown', Generator.handleMouseDown);
        window.addEventListener('mousemove', Generator.handleMouseMove);
        window.addEventListener('mouseup', Generator.handleMouseUp);
        canvas.addEventListener('wheel', Generator.handleWheel);
    },

    // --- Interactive Canvas Logic ---

    getEventPos: (e) => {
        const canvas = document.getElementById('genCanvas');
        const rect = canvas.getBoundingClientRect();
        // Return pos in Canvas Pixels (assuming canvas matches display size, but dealing with simple offset)
        // Utils.mmToPx is used by render engine. Canvas width is usually set by RenderEngine.
        return {
            x: (e.clientX - rect.left) * (canvas.width / rect.width),
            y: (e.clientY - rect.top) * (canvas.height / rect.height)
        };
    },

    handleMouseDown: (e) => {
        const pos = Generator.getEventPos(e);
        const layers = [...Generator.state.template.layers].reverse();
        
        // Calculate Scale Factor (Physical Canvas Px / Logical Layer Px)
        const logicalWidth = Utils.mmToPx(Generator.state.template.meta.widthMm); // ~204px for 54mm
        const canvas = document.getElementById('genCanvas');
        const scale = canvas.width / logicalWidth; // Likely 2 (High DPI) or 1
        
        for (const layer of layers) {
             // Only interactive if it's an image layer AND has user data
             if (layer.type === 'image' && layer.bindKey && Generator.state.formData[layer.bindKey]) {
                 
                 const lx = layer.x * scale;
                 const ly = layer.y * scale;
                 const lw = layer.w * scale;
                 const lh = layer.h * scale;

                 if (pos.x >= lx && pos.x <= lx + lw && pos.y >= ly && pos.y <= ly + lh) {
                     e.preventDefault();
                     
                     let val = Generator.state.formData[layer.bindKey];
                     if (typeof val !== 'object') {
                         val = { value: val, props: { x: 0.5, y: 0.5, zoom: 1 } };
                         Generator.state.formData[layer.bindKey] = val;
                     }
                     
                     Generator.state.activeImageKey = layer.bindKey;
                     Generator.state.dragStart = {
                         x: e.clientX,
                         y: e.clientY,
                         origProps: { ...val.props },
                         layerW: layer.w, // Logical width
                         layerH: layer.h
                     };
                     canvas.style.cursor = 'grabbing';
                     return;
                 }
             }
        }
    },

    handleMouseMove: (e) => {
        const canvas = document.getElementById('genCanvas');
        
        // Hover Logic (Cursor)
        if (!Generator.state.activeImageKey) {
            const pos = Generator.getEventPos(e);
            
            const logicalWidth = Utils.mmToPx(Generator.state.template.meta.widthMm);
            const scale = canvas.width / logicalWidth;
            
            let hover = false;
            // Check layers (top down)
            const layers = [...Generator.state.template.layers].reverse();
            for (const layer of layers) {
                 if (layer.type === 'image' && layer.bindKey && Generator.state.formData[layer.bindKey]) {
                     const lx = layer.x * scale;
                     const ly = layer.y * scale;
                     const lw = layer.w * scale;
                     const lh = layer.h * scale;
                     if (pos.x >= lx && pos.x <= lx + lw && pos.y >= ly && pos.y <= ly + lh) {
                         hover = true;
                         break;
                     }
                 }
            }
            canvas.style.cursor = hover ? 'grab' : 'default';
        }

        // Drag Logic
        if (!Generator.state.activeImageKey || !Generator.state.dragStart) return;
        
        e.preventDefault();
        const dx = e.clientX - Generator.state.dragStart.x;
        const dy = e.clientY - Generator.state.dragStart.y;
        
        // Pan Calculation
        // We need to map Screen Delta (dx) to Image Offset Delta (0..1)
        // Image Width in Pixels = layer.w * DPI_Scale (unimportant for ratio)
        // Actually: Offset 1.0 = Full Image Width.
        // We want 'drag 1 pixel' = 'move image 1 pixel'.
        // This depends on the Image Scale relative to Layer.
        // Sensitivity: 1 / (LayerWidthPx * Zoom).
        // Let's use Logical Layer Width for consistency.
        
        const zoom = Generator.state.formData[Generator.state.activeImageKey].props.zoom;
        // If I move 10 pixels on screen...
        // Screen Scale = 2 (HighDPI). So moved 5 logical pixels.
        // Layer is 50 logical pixels wide.
        // Movement is 10% of layer width.
        // So offset should change by 0.1 * (1/Zoom)?
        
        const logicalWidth = Utils.mmToPx(Generator.state.template.meta.widthMm);
        const screenScale = canvas.width / logicalWidth; // ~2
        
        const dxLogical = dx / screenScale;
        const dyLogical = dy / screenScale;
        
        const layerW = Generator.state.dragStart.layerW;
        const layerH = Generator.state.dragStart.layerH;
        
        // Adjust props
        // Note: Increasing OffsetX usually moves image LEFT (shows right part).
        // Dragging Right (dx > 0) should show LEFT part (move image right).
        // Wait, drawImageProp logic:
        // cx = (iw - cw) * offsetX.
        // If offsetX increases, cx increases, source rect moves right, so Image appears to move LEFT.
        // So Drag Right -> offsetX should DECREASE.
        
        const sensitivityX = 1 / (layerW * zoom); // Rough approx
        const sensitivityY = 1 / (layerH * zoom); // Rough approx
        
        // Use a multiplier to make it feel 1:1. 
        // Experimentally ~1.5 feels good with the drawImageProp math
        const factor = 1.0; 

        const val = Generator.state.formData[Generator.state.activeImageKey];
        val.props.x = Generator.state.dragStart.origProps.x - (dxLogical * sensitivityX * factor);
        val.props.y = Generator.state.dragStart.origProps.y - (dyLogical * sensitivityY * factor);
        
        Generator.renderCanvas();
    },

    handleMouseUp: () => {
        if (Generator.state.activeImageKey) {
            Generator.state.activeImageKey = null;
            document.getElementById('genCanvas').style.cursor = 'default';
        }
    },

    handleWheel: (e) => {
        const canvas = document.getElementById('genCanvas');
        const pos = Generator.getEventPos(e);
        const logicalWidth = Utils.mmToPx(Generator.state.template.meta.widthMm);
        const scale = canvas.width / logicalWidth;
        
        const layer = Generator.state.template.layers.find(l => {
             if (l.type !== 'image' || !l.bindKey || !Generator.state.formData[l.bindKey]) return false;
             const lx = l.x * scale;
             const ly = l.y * scale;
             const lw = l.w * scale;
             const lh = l.h * scale;
             return (pos.x >= lx && pos.x <= lx + lw && pos.y >= ly && pos.y <= ly + lh);
        });

        if (layer) { // Only zoom if hovering image
             e.preventDefault();
             let val = Generator.state.formData[layer.bindKey];
             if (typeof val !== 'object') {
                 val = { value: val, props: { x: 0.5, y: 0.5, zoom: 1 } };
                 Generator.state.formData[layer.bindKey] = val;
             }
             
             // Zoom logic (Zoom towards mouse? Center for now)
             const delta = e.deltaY > 0 ? 0.95 : 1.05; // Smoother
             val.props.zoom *= delta;
             
             if (val.props.zoom < 0.1) val.props.zoom = 0.1;
             if (val.props.zoom > 10) val.props.zoom = 10;
             
             Generator.renderCanvas();
        }
    },

    renderForm: () => {
        const container = document.getElementById('dynamicFields');
        container.innerHTML = '';
        const fields = Generator.state.template.fields || [];

        fields.forEach(field => {
            const group = document.createElement('div');
            group.className = 'form-group';
            
            const label = document.createElement('label');
            label.className = 'form-label';
            label.innerText = field.label;
            group.appendChild(label);

            let input;

            if (field.type === 'image') {
                input = document.createElement('input');
                input.type = 'file';
                input.className = 'form-control';
                input.accept = 'image/*';
                input.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        try {
                            const res = await Utils.compressImage(file, 800, 0.9);
                            // Store as object with default props
                            const data = {
                                value: res.dataUrl,
                                props: { x: 0.5, y: 0.5, zoom: 1 } 
                            };
                            Generator.updateData(field.key, data);
                            
                            // Show hint
                            const canvas = document.getElementById('genCanvas');
                            const tooltip = document.createElement('div');
                            // We should probably just use a toast or alert, but let's change cursor
                            canvas.style.cursor = 'grab';
                            // alert("Photo added! Drag and Scroll on the card to adjust.");
                        } catch (err) {
                            console.error(err);
                            alert("Failed to process image.");
                        }
                    }
                });
            } else if (field.type === 'select') {
                input = document.createElement('select');
                input.className = 'form-select';
                (field.options || []).forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt;
                    option.innerText = opt;
                    input.appendChild(option);
                });
                // Set initial value
                Generator.updateData(field.key, field.options ? field.options[0] : '');
                input.addEventListener('change', (e) => Generator.updateData(field.key, e.target.value));
            } else {
                input = document.createElement('input');
                input.type = field.type === 'number' ? 'number' : 'text';
                input.className = 'form-control';
                // Trigger update on typing
                input.addEventListener('input', (e) => Generator.updateData(field.key, e.target.value));
            }

            group.appendChild(input);
            container.appendChild(group);
        });
    },

    updateData: (key, value) => {
        Generator.state.formData[key] = value;
        Generator.renderCanvas();
    },

    renderCanvas: () => {
        const canvas = document.getElementById('genCanvas');
        RenderEngine.render(canvas, Generator.state.template, Generator.state.formData);
    },

    downloadPNG: () => {
        const canvas = document.getElementById('genCanvas');
        const link = document.createElement('a');
        link.download = `badge-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();
    },

    downloadPDF: () => {
        const { jsPDF } = window.jspdf;
        const template = Generator.state.template.meta;
        
        // Setup PDF matching template size
        const doc = new jsPDF({
            orientation: template.orientation || 'portrait',
            unit: 'mm',
            format: [template.widthMm, template.heightMm]
        });

        const canvas = document.getElementById('genCanvas');
        // Add image to PDF (0, 0 position, fill width/height)
        // High quality scale down
        const imgData = canvas.toDataURL('image/png', 1.0);
        doc.addImage(imgData, 'PNG', 0, 0, template.widthMm, template.heightMm);
        
        doc.save(`badge-${Date.now()}.pdf`);
    }
};

window.addEventListener('DOMContentLoaded', Generator.init);
