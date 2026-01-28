/**
 * Admin / Designer Logic - Advanced Editor Upgrade
 */

const App = {
    state: {
        template: {
            meta: { widthMm: 54, heightMm: 86 },
            background: { type: 'color', value: '#ffffff', fit: 'stretch' },
            fields: [],
            layers: []
        },
        selectedLayerId: null,
        clipboard: null,
        zoom: 1,
        history: [],
        historyIndex: -1,
        isDragging: false,
        dragStart: { x: 0, y: 0 },
        resizeHandle: null
    },

    init: async () => {
        // Load dependencies
        await App.loadTemplate();
        
        // Init UI
        App.bindToolbar();
        App.bindCanvasEvents();
        App.bindProperties();
        App.bindLayerList();
        App.bindBackgroundSettings();
        App.bindShortcuts();
        
        App.bgSettings.render();
        App.renderUI();
        App.renderCanvas();
    },

    loadTemplate: async () => {
        const local = Utils.storage.get('idcard_template_v2');
        if (local) {
            App.state.template = local;
        } else {
            // Load default
            try {
                const def = await fetch('templates/default.json').then(r => r.json());
                App.state.template = def;
                // Ensure new schema
                if (!App.state.template.background) {
                    App.state.template.background = { type: 'color', value: '#ffffff', fit: 'stretch' };
                    if (App.state.template.meta.backgroundImage) {
                         App.state.template.background = { type: 'image', value: App.state.template.meta.backgroundImage, fit: 'stretch' };
                    }
                }
                // Ensure Arrays
                if (!App.state.template.fields) App.state.template.fields = [];
                if (!App.state.template.layers) App.state.template.layers = [];
            } catch (e) {
                console.warn("No default template found");
            }
        }
        
        // Safety check for local loaded data too
        if (!App.state.template.fields) App.state.template.fields = [];
        if (!App.state.template.layers) App.state.template.layers = [];
        
        App.saveState(true); // Initial save for undo
    },

    saveState: (pushToHistory = true) => {
        const stateStr = JSON.stringify(App.state.template);
        Utils.storage.save('idcard_template_v2', App.state.template);

        if (pushToHistory) {
            // Remove future history if we were in middle
            if (App.state.historyIndex < App.state.history.length - 1) {
                App.state.history = App.state.history.slice(0, App.state.historyIndex + 1);
            }
            App.state.history.push(stateStr);
            if (App.state.history.length > 20) App.state.history.shift(); // Limit 20
            App.state.historyIndex = App.state.history.length - 1;
            App.updateUndoRedoButtons();
        }
    },

    restoreState: (index) => {
        if (index < 0 || index >= App.state.history.length) return;
        App.state.historyIndex = index;
        App.state.template = JSON.parse(App.state.history[index]);
        App.selectedLayerId = null;
        App.renderCanvas();
        App.renderUI();
        App.bgSettings.render();
        App.updateUndoRedoButtons();
        Utils.storage.save('idcard_template_v2', App.state.template);
    },

    undo: () => App.restoreState(App.state.historyIndex - 1),
    redo: () => App.restoreState(App.state.historyIndex + 1),

    updateUndoRedoButtons: () => {
        document.getElementById('toolUndo').disabled = App.state.historyIndex <= 0;
        document.getElementById('toolRedo').disabled = App.state.historyIndex >= App.state.history.length - 1;
        document.getElementById('toolUndo').classList.toggle('text-muted', App.state.historyIndex <= 0);
        document.getElementById('toolRedo').classList.toggle('text-muted', App.state.historyIndex >= App.state.history.length - 1);
    },

    // --- RENDERERS ---

    renderCanvas: async () => {
        const canvas = document.getElementById('previewCanvas');
        
        // Generate Mock Data for Preview so fields show their names
        // Generate Mock Data for Preview so fields show their names
        const mockData = {};
        (App.state.template.fields || []).forEach(f => {
            mockData[f.key] = `[${f.label}]`;
        });
        
        await RenderEngine.render(canvas, App.state.template, mockData);
        App.renderOverlays();
    },

    renderOverlays: () => {
        const overlay = document.getElementById('overlayLayer');
        overlay.innerHTML = '';
        
        // Render selection box
        const layer = App.getSelectedLayer();
        if (layer) {
            const scale = App.state.zoom; 
            
            const div = document.createElement('div');
            div.style.position = 'absolute';
            // Layer coords are in PX. Visual canvas is in PX.
            // Just apply zoom.
            div.style.left = (layer.x * App.state.zoom) + 'px';
            div.style.top = (layer.y * App.state.zoom) + 'px';
            div.style.width = (layer.w * App.state.zoom) + 'px';
            div.style.height = (layer.h * App.state.zoom) + 'px';
            div.style.border = '2px solid #3b82f6';
            div.style.pointerEvents = 'none'; // pass through to canvas wrapper
            
            // Handles
            const handles = ['nw', 'ne', 'se', 'sw'];
            handles.forEach(h => {
                const span = document.createElement('span');
                span.dataset.handle = h;
                span.style.position = 'absolute';
                span.style.width = '12px';
                span.style.height = '12px';
                span.style.background = '#3b82f6';
                span.style.border = '1px solid white';
                span.style.pointerEvents = 'auto'; // allow click
                span.style.cursor = (h === 'nw' || h === 'se') ? 'nwse-resize' : 'nesw-resize';
                
                if (h.includes('n')) span.style.top = '-6px'; else span.style.bottom = '-6px';
                if (h.includes('w')) span.style.left = '-6px'; else span.style.right = '-6px';
                div.appendChild(span);
            });

            overlay.appendChild(div);
        }
    },

    renderUI: () => {
        // Render Layers List
        const list = document.getElementById('layersList');
        list.innerHTML = '';
        const layers = [...App.state.template.layers].sort((a,b) => (b.zIndex||0) - (a.zIndex||0)); // Show top first
        
        layers.forEach(l => {
            const item = document.createElement('div');
            item.className = `layer-item ${l.id === App.state.selectedLayerId ? 'active' : ''}`;
            item.onclick = () => App.selectLayer(l.id);
            
            let icon = 'fa-square';
            if (l.type === 'text') icon = 'fa-font';
            if (l.type === 'image') icon = 'fa-image';
            
            let name = l.id;
            if (l.bindKey) name = `Field: ${l.bindKey}`;
            else if (l.staticText) name = `Text: ${l.staticText.substring(0,15)}`;
            else if (l.type === 'image') name = 'Image';

            item.innerHTML = `
                <div class="layer-icon"><i class="fa-solid ${icon}"></i></div>
                <div class="layer-name">${name}</div>
                <div class="layer-actions">
                    <button class="btn-layer-action" onclick="App.deleteLayer('${l.id}'); event.stopPropagation();"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            list.appendChild(item);
        });

        // Properties
        const inspector = document.getElementById('inspectorControls');
        const empty = document.getElementById('inspectorContent');
        const layer = App.getSelectedLayer();
        
        if (layer) {
            inspector.style.display = 'block';
            empty.style.display = 'none';
            
            document.getElementById('propX').value = Math.round(layer.x);
            document.getElementById('propY').value = Math.round(layer.y);
            document.getElementById('propW').value = Math.round(layer.w);
            document.getElementById('propH').value = Math.round(layer.h);
            
            const specific = document.getElementById('specificProperties');
            specific.innerHTML = '';
            
            if (layer.type === 'text') {
                 specific.innerHTML += `
                    <div class="prop-row"><span class="prop-label">Font</span><select class="form-select form-select-sm" onchange="App.updateProp('fontFamily', this.value)">
                        <option value="Arial" ${layer.fontFamily==='Arial'?'selected':''}>Arial (Default)</option>
                        <option value="Roboto" ${layer.fontFamily==='Roboto'?'selected':''}>Roboto</option>
                        <option value="Open Sans" ${layer.fontFamily==='Open Sans'?'selected':''}>Open Sans</option>
                        <option value="Montserrat" ${layer.fontFamily==='Montserrat'?'selected':''}>Montserrat</option>
                        <option value="Lato" ${layer.fontFamily==='Lato'?'selected':''}>Lato</option>
                        <option value="Oswald" ${layer.fontFamily==='Oswald'?'selected':''}>Oswald</option>
                        <option value="Courier Prime" ${layer.fontFamily==='Courier Prime'?'selected':''}>Courier (Mono)</option>
                    </select></div>
                    <div class="prop-row"><span class="prop-label">Size</span><input type="number" class="form-control form-control-sm" value="${layer.fontSize}" onchange="App.updateProp('fontSize', this.value)"></div>
                    <div class="prop-row"><span class="prop-label">Weight</span><select class="form-select form-select-sm" onchange="App.updateProp('fontWeight', this.value)">
                        <option value="normal" ${layer.fontWeight==='normal'?'selected':''}>Normal</option>
                        <option value="bold" ${layer.fontWeight==='bold'?'selected':''}>Bold</option>
                    </select></div>
                    <div class="prop-row"><span class="prop-label">Align</span><select class="form-select form-select-sm" onchange="App.updateProp('align', this.value)">
                        <option value="left" ${layer.align==='left'?'selected':''}>Left</option>
                        <option value="center" ${layer.align==='center'?'selected':''}>Center</option>
                        <option value="right" ${layer.align==='right'?'selected':''}>Right</option>
                    </select></div>
                    <div class="prop-row"><span class="prop-label">Color</span><input type="color" class="form-control form-control-sm" value="${layer.color}" onchange="App.updateProp('color', this.value)"></div>
                 `;
            }
        } else {
            inspector.style.display = 'none';
            empty.style.display = 'block';
        }

        // Render Fields List (Left Panel)
        const fieldsList = document.getElementById('fieldsList');
        if (fieldsList) {
            const fields = App.state.template.fields || [];
            console.log(`Rendering Fields: ${fields.length} items`);
            
            fieldsList.innerHTML = '';
            
            if (fields.length === 0) {
                 fieldsList.innerHTML = '<div class="text-center text-muted p-3"><small>No fields added.<br>Use toolbar to add data fields.</small></div>';
            } else {
                fields.forEach(f => {
                    const item = document.createElement('div');
                    item.className = 'list-group-item d-flex justify-content-between align-items-center p-2 border-bottom';
                    item.style.color = '#333'; // Enforce visibility
                    item.innerHTML = `
                        <div class="text-truncate">
                            <i class="fa-solid fa-tag text-primary me-2"></i>
                            <span class="fw-bold">${f.label}</span> 
                            <small class="text-muted ms-1">(${f.key})</small>
                        </div>
                        <button class="btn btn-sm btn-link text-danger p-0" onclick="App.deleteField('${f.key}')" title="Delete Field">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    `;
                    fieldsList.appendChild(item);
                });
            }
        }
    },

    deleteField: (key) => {
        if(confirm(`Delete field "${key}"? This will also remove associated layers.`)) {
            App.state.template.fields = App.state.template.fields.filter(f => f.key !== key);
            // Remove layers bound to this key
            App.state.template.layers = App.state.template.layers.filter(l => l.bindKey !== key);
            App.renderUI();
            App.renderCanvas();
            App.saveState();
        }
    },

    // --- ACTIONS ---

    selectLayer: (id) => {
        App.state.selectedLayerId = id;
        App.renderUI();
        App.renderOverlays();
    },

    getSelectedLayer: () => App.state.template.layers.find(l => l.id === App.state.selectedLayerId),

    updateProp: (key, val) => {
        const layer = App.getSelectedLayer();
        if (!layer) return;
        layer[key] = val;
        App.renderCanvas();
        App.saveState();
    },
    
    deleteLayer: (id) => {
        if (!id) id = App.state.selectedLayerId;
        if (!id) return;
        App.state.template.layers = App.state.template.layers.filter(l => l.id !== id);
        App.state.selectedLayerId = null;
        App.renderCanvas();
        App.renderUI();
        App.saveState();
    },

    addLayer: (type) => {
        const layer = {
            id: Utils.generateId(),
            zIndex: App.state.template.layers.length + 10,
            x: 10, y: 10, w: 50, h: 50
        };

        if (type === 'text-field') {
            const key = prompt("Field Name (e.g., Name, ID Number):");
            if (!key) return;
            // Add field def if not exists
            if (!App.state.template.fields.some(f => f.key === key)) {
                App.state.template.fields.push({ key, label: key, type: 'text' });
            }
            Object.assign(layer, { type: 'text', bindKey: key, fontSize: 14, color: '#000000', w: 100, h: 20 });
        } 
        else if (type === 'static-text') {
            Object.assign(layer, { type: 'text', staticText: 'TEXT', fontSize: 18, fontWeight: 'bold', color: '#000000', w: 80, h: 20 });
        }
        else if (type === 'shape-rect') {
            Object.assign(layer, { type: 'shape', shapeType: 'rect', fill: '#3b82f6', w: 100, h: 20 });
        }
        else if (type === 'image-field') {
             const key = prompt("Photo Field Name (e.g. Photo):");
             if(!key) return;
             if (!App.state.template.fields.some(f => f.key === key)) {
                App.state.template.fields.push({ key, label: key, type: 'image' });
             }
             Object.assign(layer, { type: 'image', bindKey: key, w: 80, h: 80, objectFit: 'cover' });
        }

        App.state.template.layers.push(layer);
        App.selectLayer(layer.id);
        App.renderCanvas();
        App.renderUI();
        App.saveState();
    },

    changeZIndex: (dir) => {
        const layer = App.getSelectedLayer();
        if(!layer) return;
        layer.zIndex += dir;
        App.renderCanvas();
        App.renderUI(); // Re-sort list
        App.saveState();
    },

    // --- BACKGROUND SETTINGS ---
    bgSettings: {
        render: () => {
            try {
                const t = App.state.template;
                const bg = t.background || { type: 'color' };
                const preview = document.getElementById('bgPreviewImage');
                const cont = document.getElementById('bgPreviewContainer');
                const opts = document.getElementById('bgOptions');
                const uploadBtn = document.getElementById('btnUploadBg');

                if (bg.type === 'image' && bg.value && typeof bg.value === 'string') {
                    if (cont) cont.style.display = 'block';
                    if (preview) preview.src = bg.value;
                    if (opts) opts.style.display = 'block';
                    if (uploadBtn) uploadBtn.innerText = "Replace Image";
                    
                    // Calc size
                    const sizeKB = Math.round((bg.value.length * 0.75) / 1024);
                    const infoEL = document.getElementById('bgSizeInfo');
                    if (infoEL) infoEL.innerText = `~${sizeKB} KB`;
                    
                    const fitSel = document.getElementById('bgFitSelect');
                    if(fitSel) fitSel.value = bg.fit || 'stretch';
                } else {
                    if (cont) cont.style.display = 'none';
                    if (opts) opts.style.display = 'none';
                    if (uploadBtn) uploadBtn.innerText = "Upload Image";
                }
            } catch (e) {
                console.error("Error rendering BG settings:", e);
            }
        },
        
        handleUpload: async (file) => {
            try {
                // 1. Auth Check (Removed)
                const token = App.ensureAuth();
                // if (!token) return alert("Admin Token required for Cloud Upload.");

                // 2. Compress
                const res = await Utils.compressImage(file, 1600, 0.85); // High quality for cloud
                
                // 3. Convert DataURL to Blob for upload
                const fetchRes = await fetch(res.dataUrl);
                const blobData = await fetchRes.blob();

                // 4. Upload to Vercel Blob (Proxied Upload)
                const uploadBtn = document.getElementById('btnUploadBg');
                const origText = uploadBtn.innerText;
                uploadBtn.innerText = "Uploading...";
                uploadBtn.disabled = true;

                // Send RAW BINARY using our custom proxy
                // We set x-filename header so the API knows the name
                const uploadRes = await fetch(`/api/upload-proxy?filename=backgrounds/${file.name}`, { 
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }, // Optional if disabled
                    body: blobData 
                });

                if(!uploadRes.ok) throw new Error("Cloud upload failed");
                const uploadResult = await uploadRes.json();

                App.state.template.background = {
                    type: 'image',
                    value: uploadResult.url, // Cloud URL
                    fit: 'stretch'
                };
                
                App.bgSettings.render();
                App.renderCanvas();
                App.saveState();
                
                uploadBtn.innerText = origText;
                uploadBtn.disabled = false;

            } catch (e) {
                console.error(e);
                alert("Upload failed: " + e.message);
                document.getElementById('btnUploadBg').innerText = "Upload Image";
                document.getElementById('btnUploadBg').disabled = false;
            }
        },
        
        remove: () => {
             App.state.template.background = { type: 'color', value: '#ffffff' };
             App.bgSettings.render();
             App.renderCanvas();
             App.saveState();
        },
        
        updateFit: (fit) => {
            if (App.state.template.background) {
                App.state.template.background.fit = fit;
                App.renderCanvas();
                App.saveState();
            }
        }
    },

    // --- BINDINGS ---

    bindToolbar: () => {
        document.querySelectorAll('[data-add]').forEach(b => {
            b.onclick = () => App.addLayer(b.dataset.add);
        });
        
        document.getElementById('toolUndo').onclick = App.undo;
        document.getElementById('toolRedo').onclick = App.redo;
        
        document.getElementById('toolDelete').onclick = () => App.deleteLayer();
        
        document.getElementById('toolBringFront').onclick = () => App.changeZIndex(1);
        document.getElementById('toolSendBack').onclick = () => App.changeZIndex(-1);

        document.getElementById('zoomSlider').oninput = (e) => {
            App.state.zoom = parseInt(e.target.value) / 100;
            document.getElementById('zoomLevel').innerText = e.target.value + '%';
            
            // Resize display canvas container, not the canvas pixels itself
            const wrapper = document.getElementById('canvasWrapper');
            // Logic to zoom: transform scale
            // Simple approach: re-render overlay is enough, standard CSS zoom on wrapper
            wrapper.style.transform = `scale(${App.state.zoom})`;
            wrapper.style.transformOrigin = 'top left';
            
            App.renderOverlays(); // update selection box positions
        };
        
        
        // Share
        document.getElementById('btnShareLink').onclick = App.shareLink;
    },

    bindProperties: () => {
        // Numeric inputs
        ['propX','propY','propW','propH'].forEach(id => {
            document.getElementById(id).onchange = (e) => {
                const key = id.replace('prop','').toLowerCase();
                App.updateProp(key, parseInt(e.target.value));
            };
        });
        
        // Document
        document.getElementById('inputWidth').onchange = (e) => {
            App.state.template.meta.widthMm = parseInt(e.target.value);
            App.renderCanvas(); App.saveState();
        };
        document.getElementById('inputHeight').onchange = (e) => {
            App.state.template.meta.heightMm = parseInt(e.target.value);
            App.renderCanvas(); App.saveState();
        };
    },
    
    bindBackgroundSettings: () => {
        const fileInput = document.getElementById('fileBgUpload');
        
        document.getElementById('btnUploadBg').onclick = () => fileInput.click();
        
        fileInput.onchange = (e) => {
            if (e.target.files.length) App.bgSettings.handleUpload(e.target.files[0]);
        };
        
        document.getElementById('btnRemoveBg').onclick = App.bgSettings.remove;
        
        document.getElementById('bgFitSelect').onchange = (e) => App.bgSettings.updateFit(e.target.value);
    },

    bindCanvasEvents: () => {
        const wrapper = document.getElementById('canvasWrapper');
        
        wrapper.onmousedown = (e) => {
            // Check if clicking a handle
            if (e.target.dataset.handle) {
                const handle = e.target.dataset.handle;
                App.state.isResizing = true;
                App.state.resizeHandle = handle;
                
                // Click pos
                const rect = wrapper.getBoundingClientRect();
                const scale = App.state.zoom;
                const clickX = (e.clientX - rect.left) / scale;
                const clickY = (e.clientY - rect.top) / scale;
                
                const layer = App.getSelectedLayer();
                App.state.dragStart = { 
                    x: clickX, y: clickY, 
                    origX: layer.x, origY: layer.y,
                    origW: layer.w, origH: layer.h,
                    origFontSize: layer.fontSize || 16 // Store initial font size
                };
                e.stopPropagation();
                e.preventDefault();
                return;
            }

            if (e.target === wrapper || e.target.id === 'previewCanvas' || e.target.id === 'overlayLayer') {
                // Clicked on empty space -> Deselect
                App.selectLayer(null);
                
                // Calculate click pos in PX (relative to unzoomed canvas)
                const rect = wrapper.getBoundingClientRect();
                const scale = App.state.zoom;
                // e.clientX is global. rect.left is current zoomed pos.
                // (client - rect) gives zoomed pixels. Divide by scale to get unzoomed canvas pixels.
                const clickX = (e.clientX - rect.left) / scale;
                const clickY = (e.clientY - rect.top) / scale;

                // Hit test
                const layers = [...App.state.template.layers].sort((a,b) => b.zIndex - a.zIndex); // Top first
                for (const l of layers) {
                    if (clickX >= l.x && clickX <= l.x + l.w && clickY >= l.y && clickY <= l.y + l.h) {
                        App.selectLayer(l.id);
                        
                        // Start drag
                        App.state.isDragging = true;
                        App.state.dragStart = { x: clickX, y: clickY, origX: l.x, origY: l.y };
                        e.preventDefault(); // stop selection
                        return;
                    }
                }
            }
        };

        window.onmousemove = (e) => {
            if (!App.state.selectedLayerId) return;

            const wrapper = document.getElementById('canvasWrapper');
            const rect = wrapper.getBoundingClientRect();
            const scale = App.state.zoom;
            
            const curX = (e.clientX - rect.left) / scale;
            const curY = (e.clientY - rect.top) / scale;
            const dx = curX - App.state.dragStart.x;
            const dy = curY - App.state.dragStart.y;
            const layer = App.getSelectedLayer();

            if (App.state.isDragging) {
                layer.x = App.state.dragStart.origX + dx;
                layer.y = App.state.dragStart.origY + dy;
            } 
            else if (App.state.isResizing) {
                const h = App.state.resizeHandle;
                // Scale Tracking
                let newW = layer.w;
                let newH = layer.h;

                // Simple resizing
                if (h.includes('e')) newW = Math.max(10, App.state.dragStart.origW + dx);
                if (h.includes('s')) newH = Math.max(10, App.state.dragStart.origH + dy);
                if (h.includes('w')) {
                    newW = Math.max(10, App.state.dragStart.origW - dx);
                    if (newW > 10) layer.x = App.state.dragStart.origX + dx;
                }
                if (h.includes('n')) {
                    newH = Math.max(10, App.state.dragStart.origH - dy);
                    if (newH > 10) layer.y = App.state.dragStart.origY + dy;
                }
                
                // Update dims
                layer.w = newW;
                layer.h = newH;

                // Text Scaling Logic
                if (layer.type === 'text') {
                    // Calculate scale ratio based on Height change (usually safer for text)
                    // limit min font size to 4
                    const scaleRatio = newH / App.state.dragStart.origH;
                    layer.fontSize = Math.max(4, Math.round(App.state.dragStart.origFontSize * scaleRatio));
                }
            }
            
            if (App.state.isDragging || App.state.isResizing) {
               App.renderCanvas(); 
               App.renderOverlays();
               document.getElementById('propX').value = Math.round(layer.x);
               document.getElementById('propY').value = Math.round(layer.y);
               document.getElementById('propW').value = Math.round(layer.w);
               document.getElementById('propH').value = Math.round(layer.h);
            }
        };

        window.onmouseup = () => {
            if (App.state.isDragging || App.state.isResizing) {
                App.state.isDragging = false;
                App.state.isResizing = false;
                App.saveState(); // Commit change
            }
        };
    },

    bindShortcuts: () => {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return; // Ignore if typing
            
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) App.redo(); else App.undo();
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                App.deleteLayer();
            }
            // Arrows for nudge
            if (App.state.selectedLayerId && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
                e.preventDefault();
                const layer = App.getSelectedLayer();
                const step = e.shiftKey ? 10 : 1;
                if (e.key === 'ArrowUp') layer.y -= step;
                if (e.key === 'ArrowDown') layer.y += step;
                if (e.key === 'ArrowLeft') layer.x -= step;
                if (e.key === 'ArrowRight') layer.x += step;
                App.renderCanvas(); App.renderOverlays();
                // Debounce save? allow for now
            }
        });
        
        // Add save on keyup for arrows to avoid history spam? 
        // For simplicity, we just won't save on every nudged pixel in this version or we'd spam history.
    },
    
    bindLayerList: () => {
        // Implemented in renderUI
    },

    ensureAuth: () => {
        // Auth removed for ease of use
        return "public";
    },

    publishTemplate: async () => {
        const token = App.ensureAuth();
        // if (!token) return alert("Admin Token required.");

        const name = document.getElementById('inputTemplateName').value || 'untitled';
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'template-' + Date.now();
        
        const btn = document.getElementById('btnPublish'); // Assume we add this button
        if(btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        try {
            const res = await fetch('/api/publish', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    slug: slug,
                    template: App.state.template
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Publish failed');

            // Success UI
            const shareUrl = `${window.location.href.replace('admin.html', 'index.html').split('?')[0]}?template=${data.slug}`;
            
            // Show modal manually or reuse share modal
            const modalEl = document.getElementById('shareModal');
            const modal = new bootstrap.Modal(modalEl);
            modalEl.querySelector('.modal-body').innerHTML = `
                <div class="text-center mb-3">
                    <div class="text-success display-4 mb-2"><i class="fa-solid fa-check-circle"></i></div>
                    <h5>Published Successfully!</h5>
                </div>
                <label class="small text-muted">Public Link:</label>
                <div class="input-group mb-3">
                    <input type="text" class="form-control" value="${shareUrl}" readonly onclick="this.select()">
                    <a href="${shareUrl}" target="_blank" class="btn btn-outline-primary"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                </div>
                <div class="alert alert-light border small">
                    <i class="fa-solid fa-info-circle"></i> Data saved to Cloud. Background image must be uploaded via Cloud Upload first.
                </div>
            `;
            modal.show();

        } catch (e) {
            console.error(e);
            alert("Publish Error: " + e.message);
        } finally {
            if(btn) btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Publish';
        }
    },

    shareLink: () => {
        // 1. Generate Slug
        const name = document.getElementById('inputTemplateName').value || 'untitled';
        const sanitized = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'template';
        const unique = Math.floor(Date.now() / 1000).toString(36);
        const slug = `${sanitized}-${unique}`;
        
        // 2. Prepare JSON Blob (Method A: File)
        const jsonStr = JSON.stringify(App.state.template, null, 2);
        const blob = new Blob([jsonStr], {type: "application/json"});
        const blobUrl = URL.createObjectURL(blob);
        const staticShareUrl = `${window.location.href.replace('admin.html', 'index.html').split('?')[0]}?template=${slug}`;

        // 3. Prepare Encoded URL (Method B: Instant)
        const encoded = Utils.encodeTemplate(App.state.template);
        const instantShareUrl = `${window.location.href.replace('admin.html', 'index.html').split('?')[0]}?t=${encoded}`;
        
        // 4. Update Modal UI
        const modalEl = document.getElementById('shareModal');
        const modal = new bootstrap.Modal(modalEl);
        const body = modalEl.querySelector('.modal-body');
        
        // Check URL length safety (approx 2000 limit for some browsers, though modern ones support much more)
        const urlWarning = instantShareUrl.length > 2000 ? 
            `<div class="alert alert-warning py-1 small mb-2"><i class="fa-solid fa-triangle-exclamation"></i> Link is long (${Math.round(instantShareUrl.length/1024)}KB). If it fails, use the 'File Host' method below.</div>` : '';

        body.innerHTML = `
            <!-- METHOD 1: INSTANT LINK -->
            <h6 class="fw-bold text-primary"><i class="fa-solid fa-bolt"></i> Instant Share Link</h6>
            <p class="small text-muted mb-2">Copy this link to share immediately. No file upload required.</p>
            ${urlWarning}
            <div class="input-group mb-4">
                <input type="text" class="form-control font-monospace small" value="${instantShareUrl}" id="shareLinkInstant" readonly onclick="this.select()">
                <button class="btn btn-primary" id="btnCopyInstant"><i class="fa-regular fa-copy"></i> Copy</button>
                <a href="${instantShareUrl}" target="_blank" class="btn btn-outline-secondary"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
            </div>

            <hr>

            <!-- METHOD 2: STATIC FILE -->
            <h6 class="fw-bold text-secondary"><i class="fa-solid fa-server"></i> File Host (For Developers)</h6>
            <p class="small text-muted mb-2">Best for permanent hosting on Vercel/Netlify. Prevents long URLs.</p>
            
            <div class="d-flex align-items-center gap-2 mb-3 bg-light p-2 rounded">
                <a href="${blobUrl}" download="${slug}.json" class="btn btn-sm btn-outline-success">
                    <i class="fa-solid fa-download"></i> Download JSON
                </a>
                <div class="small text-muted border-start ps-2">
                    Upload to <code>/templates/${slug}.json</code>
                </div>
            </div>
            
            <p class="small text-muted mb-1">Then use this link:</p>
            <div class="input-group mb-2">
                <input type="text" class="form-control font-monospace form-control-sm text-muted" value="${staticShareUrl}" id="shareLinkStatic" readonly onclick="this.select()">
                <button class="btn btn-sm btn-outline-secondary" id="btnCopyStatic"><i class="fa-regular fa-copy"></i></button>
            </div>
        `;
        
        // Bind Copy Buttons
        setTimeout(() => {
            const bindCopy = (btnId, inputId) => {
                const btn = document.getElementById(btnId);
                if(btn) btn.onclick = () => {
                    const input = document.getElementById(inputId);
                    input.select();
                    navigator.clipboard.writeText(input.value);
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
                    setTimeout(() => btn.innerHTML = originalText, 2000);
                };
            };
            bindCopy('btnCopyInstant', 'shareLinkInstant');
            bindCopy('btnCopyStatic', 'shareLinkStatic');
        }, 100);
        
        modal.show();
    }
};

window.onload = App.init;
