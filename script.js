const READIT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="115" fill="#FFFFFF"/><g transform="translate(46, 36) scale(3.5)"><rect x="14" y="8" width="22" height="75" rx="5" fill="#111111"/><rect x="14" y="18" width="22" height="4" fill="#E5E5E5"/><rect x="14" y="26" width="22" height="4" fill="#E5E5E5"/><rect x="14" y="68" width="22" height="4.5" fill="#E5E5E5"/><rect x="42" y="8" width="22" height="75" rx="5" fill="#222222"/><rect x="42" y="18" width="22" height="4" fill="#E5E5E5"/><rect x="42" y="26" width="22" height="4" fill="#E5E5E5"/><rect x="42" y="68" width="22" height="4.5" fill="#E5E5E5"/><g transform="rotate(-12 85 45)"><rect x="74" y="8" width="22" height="75" rx="5" fill="#000000"/><rect x="74" y="18" width="22" height="4" fill="#E5E5E5"/><rect x="74" y="26" width="22" height="4" fill="#E5E5E5"/><rect x="74" y="68" width="22" height="4.5" fill="#E5E5E5"/></g><text x="60" y="114" font-family="Arial, sans-serif" font-weight="900" font-size="27" text-anchor="middle" fill="#000000">ReadIT</text></g></svg>`;

const MONO_ICONS = {
    pdfDoc: `<svg class="w-5 h-5 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M13 3v5a1 1 0 001 1h5"></path></svg>`,
    folder: `<svg class="w-4 h-4 text-neutral-400 hover:text-white transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>`,
    sun: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>`,
    moon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>`
};

let appData = {
    folders: [],
    pdfs: [],
    quotes: [],
    trash: [],
    sortBy: 'dateDesc',
    viewMode: 'list',
    scrollDirection: 'horizontal',
    readerBgColor: '#000000',
    isDarkModeInverted: false,
    isAppInstalled: false
};

const memoryPdfStore = new Map();

let currentView = 'home';
let activeFolderId = null;
let activePdfId = null;
let selectedFolderColor = '#4273E3';
let cachedSelectedText = '';

let isSelectMode = false;
let selectedPdfIds = new Set();
let isBulkMove = false;

let activePdfDoc = null;
let currentReaderPage = 1;
let totalReaderPages = 1;
let scrollDirection = 'horizontal';
let isDarkModeInverted = false;
let readerUiVisible = true;

let baseFitScale = 1.0;
let basePageWidth = 0;
let basePageHeight = 0;
let userZoomMultiplier = 1.0;
let verticalRenderObserver = null;
let activeRenderTask = null;
let sharpRenderDebounceTimer = null;
let isRestoringPosition = false;
let scrollTickScheduled = false;

let touchStartX = 0;
let touchStartY = 0;
let isPinching = false;
let pinchStartDist = 0;
let pinchStartZoom = 1.0;
let pinchDocPointX = 0;
let pinchDocPointY = 0;
let pinchTargetSlot = null;
let lastTapTimestamp = 0;
let deferredInstallPrompt = null;

let db = null;
const DB_NAME = 'ReadIT_PDFReaderDB_v2';
const STORE_NAME = 'pdfBinaryStore';

function initDatabase() {
    return new Promise((resolve) => {
        try {
            if (!window.indexedDB) {
                document.getElementById('storageEngineStatus').innerText = 'RAM Mode';
                return resolve(null);
            }
            const request = indexedDB.open(DB_NAME, 1);
            request.onerror = () => {
                document.getElementById('storageEngineStatus').innerText = 'RAM Fallback';
                resolve(null);
            };
            request.onsuccess = (e) => {
                db = e.target.result;
                resolve(db);
            };
            request.onupgradeneeded = (e) => {
                const database = e.target.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME);
                }
            };
        } catch (err) {
            resolve(null);
        }
    });
}

async function storePdfBinary(id, uint8Array) {
    memoryPdfStore.set(id, uint8Array);
    if (!db) return;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(uint8Array, id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

async function retrievePdfBinary(id) {
    if (memoryPdfStore.has(id)) {
        return new Uint8Array(memoryPdfStore.get(id));
    }
    if (!db) return null;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(id);
            req.onsuccess = () => {
                if (req.result) {
                    const arr = new Uint8Array(req.result);
                    memoryPdfStore.set(id, arr);
                    resolve(new Uint8Array(arr));
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => resolve(null);
        } catch (e) {
            resolve(null);
        }
    });
}

async function removePdfBinary(id) {
    memoryPdfStore.delete(id);
    if (!db) return;
    try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
    } catch (e) {}
}

function loadMetadata() {
    try {
        const raw = localStorage.getItem('samsung_reader_meta_v2');
        if (raw) {
            const parsed = JSON.parse(raw);
            appData.folders = parsed.folders || [];
            appData.pdfs = parsed.pdfs || [];
            appData.quotes = parsed.quotes || [];
            appData.trash = parsed.trash || [];
            appData.sortBy = parsed.sortBy || 'dateDesc';
            appData.viewMode = parsed.viewMode || 'list';
            appData.scrollDirection = parsed.scrollDirection || 'horizontal';
            appData.readerBgColor = parsed.readerBgColor || '#000000';
            appData.isDarkModeInverted = Boolean(parsed.isDarkModeInverted);
        }
        appData.isAppInstalled = localStorage.getItem('samsung_pwa_hidden') === 'true' || window.matchMedia('(display-mode: standalone)').matches;
    } catch (e) {}

    scrollDirection = appData.scrollDirection;
    isDarkModeInverted = appData.isDarkModeInverted;

    const defaultScrollEl = document.getElementById('defaultScrollSelect');
    if (defaultScrollEl) defaultScrollEl.value = scrollDirection;

    const viewer = document.getElementById('pdfViewerContainer');
    if (viewer) viewer.style.backgroundColor = appData.readerBgColor;

    const dmBtn = document.getElementById('darkModeToggleBtn');
    if (dmBtn) dmBtn.innerHTML = isDarkModeInverted ? MONO_ICONS.sun : MONO_ICONS.moon;

    if (appData.isAppInstalled) {
        const btn = document.getElementById('drawerDownloadAppBtn');
        if (btn) btn.style.display = 'none';
    }
}

function saveMetadata() {
    try {
        localStorage.setItem('samsung_reader_meta_v2', JSON.stringify({
            folders: appData.folders,
            pdfs: appData.pdfs,
            quotes: appData.quotes,
            trash: appData.trash,
            sortBy: appData.sortBy,
            viewMode: appData.viewMode,
            scrollDirection: scrollDirection,
            readerBgColor: appData.readerBgColor,
            isDarkModeInverted: isDarkModeInverted
        }));
    } catch (e) {}
}

function generatePngIconDataUrl(size) {
    return new Promise((resolve) => {
        const img = new Image();
        const svgBlob = new Blob([READIT_LOGO_SVG], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve('');
        img.src = url;
    });
}

async function setupDynamicPWA() {
    try {
        const icon192 = await generatePngIconDataUrl(192);
        const icon512 = await generatePngIconDataUrl(512);

        const fav = document.createElement('link');
        fav.rel = 'icon';
        fav.href = icon192;
        document.head.appendChild(fav);

        const appleIcon = document.createElement('link');
        appleIcon.rel = 'apple-touch-icon';
        appleIcon.href = icon192;
        document.head.appendChild(appleIcon);

        const startUrl = window.location.origin + window.location.pathname;

        const manifest = {
            id: startUrl,
            name: "ReadIT PDF Reader",
            short_name: "ReadIT",
            description: "ReadIT - Minimal Monochrome AMOLED PDF Reader",
            start_url: startUrl,
            scope: startUrl,
            display: "standalone",
            background_color: "#000000",
            theme_color: "#000000",
            orientation: "portrait-primary",
            icons: [
                {
                    src: icon192,
                    sizes: "192x192",
                    type: "image/png",
                    purpose: "any maskable"
                },
                {
                    src: icon512,
                    sizes: "512x512",
                    type: "image/png",
                    purpose: "any maskable"
                }
            ]
        };

        const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = URL.createObjectURL(blob);
        document.head.appendChild(link);
    } catch (e) {}

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        const btn = document.getElementById('drawerDownloadAppBtn');
        if (btn) btn.style.display = 'flex';
    });

    window.addEventListener('appinstalled', () => {
        closePWAInstallModal(true);
        showToast("ReadIT installed");
    });
}

async function triggerPWAInstall() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') closePWAInstallModal(true);
        deferredInstallPrompt = null;
    } else {
        document.getElementById('pwaInstallModal').classList.remove('hidden');
    }
}

function closePWAInstallModal(hidePermanently) {
    document.getElementById('pwaInstallModal').classList.add('hidden');
    if (hidePermanently) {
        appData.isAppInstalled = true;
        try { localStorage.setItem('samsung_pwa_hidden', 'true'); } catch(e) {}
        const btn = document.getElementById('drawerDownloadAppBtn');
        if (btn) btn.style.display = 'none';
    }
}

async function configureOfflinePdfWorker() {
    if (!window.pdfjsLib) return;
    const workerCdnUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    try {
        const res = await fetch(workerCdnUrl);
        if (res.ok) {
            const workerCode = await res.text();
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
            return;
        }
    } catch (e) {}
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerCdnUrl;
}

window.addEventListener('DOMContentLoaded', async () => {
    await configureOfflinePdfWorker();
    setupDynamicPWA();
    await initDatabase();
    loadMetadata();
    renderWorkspace();

    const fileInput = document.getElementById('pdfFileInput');
    fileInput.addEventListener('change', handleFileInputSelection);

    const vertArea = document.getElementById('verticalScrollArea');
    vertArea.addEventListener('scroll', handleVerticalScrollTracking, { passive: true });

    setupReaderGestures();
    document.addEventListener('selectionchange', handleTextSelectionChange);

    window.addEventListener('resize', () => {
        if (currentView === 'reader' && activePdfDoc && userZoomMultiplier === 1.0 && !isPinching) {
            if (scrollDirection === 'vertical') setupVerticalVirtualReader(false);
            else renderSingleHorizontalPage(currentReaderPage, true);
        }
    });
});

async function handleFileInputSelection(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const overlay = document.getElementById('globalLoadingOverlay');
    const overlayText = document.getElementById('loadingOverlayText');
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');

    let addedCount = 0;
    let lastAddedId = null;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        overlayText.innerText = `Importing "${file.name}" (${i + 1}/${files.length})...`;

        try {
            const rawBuffer = await readFileAsArrayBuffer(file);
            const masterBytes = new Uint8Array(rawBuffer);
            const workerCopy = new Uint8Array(masterBytes);

            let pageCount = 1;
            try {
                if (window.pdfjsLib) {
                    const loadingTask = pdfjsLib.getDocument({ data: workerCopy });
                    const pdfDoc = await loadingTask.promise;
                    pageCount = pdfDoc.numPages;
                }
            } catch (pdfErr) {}

            const newId = 'pdf_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
            await storePdfBinary(newId, masterBytes);

            const cleanTitle = file.name.replace(/\.[^/.]+$/, "");
            const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1) + ' MB';

            appData.pdfs.unshift({
                id: newId,
                title: cleanTitle,
                date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                timestamp: Date.now(),
                pages: pageCount,
                lastPage: 1,
                lastPageOffsetRatio: 0,
                size: fileSizeMB,
                folderId: currentView === 'folder' ? activeFolderId : null,
                isFav: false
            });

            lastAddedId = newId;
            addedCount++;
        } catch (err) {
            showToast(`Could not import ${file.name}`);
        }
    }

    saveMetadata();
    renderWorkspace();

    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
    event.target.value = '';

    if (addedCount === 1 && lastAddedId) {
        openReader(lastAddedId);
    } else if (addedCount > 1) {
        showToast(`${addedCount} PDFs imported`);
    }
}

function readFileAsArrayBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

function navigateView(viewName, folderId = null) {
    currentView = viewName;
    activeFolderId = viewName === 'folder' ? folderId : null;
    exitSelectMode();
    renderWorkspace();
}

function renderWorkspace() {
    document.getElementById('sidebarAllPdfCount').innerText = appData.pdfs.length;
    document.getElementById('sidebarFavCount').innerText = appData.pdfs.filter(p => p.isFav).length;
    document.getElementById('sidebarQuotesCount').innerText = appData.quotes.length;
    document.getElementById('sidebarTrashCount').innerText = appData.trash.length;

    ['navItemAll', 'navItemFav', 'navItemQuotes', 'navItemTrash'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = "flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-neutral-900 text-neutral-400 cursor-pointer transition";
    });
    const activeMap = { home: 'navItemAll', favorites: 'navItemFav', quotes: 'navItemQuotes', trash: 'navItemTrash' };
    if (activeMap[currentView]) {
        document.getElementById(activeMap[currentView]).className = "flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-neutral-900 text-white font-semibold cursor-pointer transition border border-neutral-800";
    }

    renderSidebarFolders();

    const foldersSec = document.getElementById('foldersSectionWrapper');
    const booksSec = document.getElementById('booksSectionWrapper');
    const quotesSec = document.getElementById('quotesSectionWrapper');
    const trashSec = document.getElementById('trashSectionWrapper');
    const capsule = document.getElementById('folderBreadcrumbCapsule');

    foldersSec.classList.add('hidden');
    booksSec.classList.add('hidden');
    quotesSec.classList.add('hidden');
    trashSec.classList.add('hidden');
    capsule.classList.add('hidden');

    const titleEl = document.getElementById('mainHeaderTitle');
    const subEl = document.getElementById('mainHeaderSubtitle');

    if (currentView === 'home') {
        titleEl.innerText = 'Folders';
        subEl.innerText = `${appData.folders.length} folders, ${appData.pdfs.length} PDFs`;
        foldersSec.classList.remove('hidden');
        booksSec.classList.remove('hidden');
        document.getElementById('contentSectionHeading').innerText = 'All PDFs';
        renderFoldersGrid();
        renderPdfCollection(appData.pdfs);
    } else if (currentView === 'folder') {
        const folder = appData.folders.find(f => f.id === activeFolderId);
        if (!folder) return navigateView('home');
        const folderPdfs = appData.pdfs.filter(p => p.folderId === folder.id);
        titleEl.innerText = folder.name;
        subEl.innerText = `${folderPdfs.length} PDFs`;
        capsule.classList.remove('hidden');
        document.getElementById('capsuleFolderName').innerText = folder.name;
        document.getElementById('capsuleFolderIcon').style.backgroundColor = folder.color;
        booksSec.classList.remove('hidden');
        document.getElementById('contentSectionHeading').innerText = `Books in ${folder.name}`;
        renderPdfCollection(folderPdfs);
    } else if (currentView === 'favorites') {
        const favPdfs = appData.pdfs.filter(p => p.isFav);
        titleEl.innerText = 'Favorites';
        subEl.innerText = `${favPdfs.length} bookmarked PDFs`;
        booksSec.classList.remove('hidden');
        document.getElementById('contentSectionHeading').innerText = 'Favorite Books';
        renderPdfCollection(favPdfs);
    } else if (currentView === 'quotes') {
        titleEl.innerText = 'Saved Quotes';
        subEl.innerText = `${appData.quotes.length} saved highlights`;
        quotesSec.classList.remove('hidden');
        renderQuotesList();
    } else if (currentView === 'trash') {
        titleEl.innerText = 'Trash';
        subEl.innerText = `${appData.trash.length} deleted items`;
        trashSec.classList.remove('hidden');
        renderTrashList();
    }
}

function renderFoldersGrid() {
    const container = document.getElementById('foldersGridContainer');
    if (appData.folders.length === 0) {
        container.innerHTML = `
            <div onclick="openCreateFolderModal()" class="col-span-full border border-dashed border-neutral-800 hover:border-neutral-600 rounded-2xl p-5 text-center cursor-pointer transition">
                <p class="text-xs text-neutral-500">+ Tap to create your first folder</p>
            </div>
        `;
        return;
    }

    container.innerHTML = appData.folders.map(f => {
        const count = appData.pdfs.filter(p => p.folderId === f.id).length;
        return `
            <div onclick="navigateView('folder', '${f.id}')" class="bg-cardBg hover:bg-cardHover border border-neutral-800/90 rounded-2xl p-3.5 flex flex-col justify-between h-28 cursor-pointer transition active:scale-95 relative overflow-hidden group">
                <div class="absolute top-0 left-0 right-0 h-6 transition-all" style="background-color: ${f.color}"></div>
                <div class="flex items-center justify-between mt-4 z-10">
                    <span class="text-xs font-semibold text-neutral-400">${count}</span>
                    ${MONO_ICONS.folder}
                </div>
                <span class="text-xs sm:text-sm font-bold text-white truncate z-10">${escapeHtml(f.name)}</span>
            </div>
        `;
    }).join('');
}

function getSortedPdfs(list) {
    const copy = [...list];
    if (appData.sortBy === 'titleAsc') return copy.sort((a, b) => a.title.localeCompare(b.title));
    if (appData.sortBy === 'titleDesc') return copy.sort((a, b) => b.title.localeCompare(a.title));
    if (appData.sortBy === 'pagesDesc') return copy.sort((a, b) => (b.pages || 0) - (a.pages || 0));
    return copy.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

function renderPdfCollection(pdfArray) {
    const container = document.getElementById('pdfItemsContainer');
    const sorted = getSortedPdfs(pdfArray);

    if (sorted.length === 0) {
        container.className = "space-y-2.5";
        container.innerHTML = `
            <div class="bg-neutral-950 border border-neutral-900 rounded-3xl p-10 text-center space-y-3">
                <div class="flex justify-center">${MONO_ICONS.pdfDoc}</div>
                <p class="text-sm font-medium text-neutral-300">No PDF books found</p>
                <p class="text-xs text-neutral-500">Tap <b class="text-white">PDF+</b> above to import files.</p>
            </div>
        `;
        return;
    }

    container.className = appData.viewMode === 'grid' ? "grid grid-cols-2 sm:grid-cols-3 gap-3" : "space-y-2.5";

    container.innerHTML = sorted.map(p => {
        const folderObj = appData.folders.find(f => f.id === p.folderId);
        const isSelected = selectedPdfIds.has(p.id);
        const savedPageNum = parseInt(p.lastPage, 10) || 1;

        if (appData.viewMode === 'grid') {
            return `
                <div onclick="handlePdfCardInteraction('${p.id}')" class="bg-cardBg hover:bg-cardHover border ${isSelected ? 'border-white ring-1 ring-white' : 'border-neutral-800/80'} rounded-2xl p-4 flex flex-col justify-between h-40 cursor-pointer transition relative">
                    <div class="flex items-start justify-between">
                        <div class="w-10 h-12 bg-neutral-900 border border-neutral-800 rounded-lg flex items-center justify-center">
                            ${MONO_ICONS.pdfDoc}
                        </div>
                        <button onclick="event.stopPropagation(); toggleFavoriteBookFromList('${p.id}')" class="text-base ${p.isFav ? 'text-white' : 'text-neutral-600 hover:text-white'}">${p.isFav ? '★' : '☆'}</button>
                    </div>
                    <div>
                        <h4 class="text-xs sm:text-sm font-bold text-white line-clamp-2">${escapeHtml(p.title)}</h4>
                        <p class="text-[11px] text-neutral-500 mt-1">${p.pages || 1} pages ${savedPageNum > 1 ? `• p.${savedPageNum}` : ''}</p>
                    </div>
                </div>
            `;
        }

        return `
            <div onclick="handlePdfCardInteraction('${p.id}')" class="bg-cardBg hover:bg-cardHover border ${isSelected ? 'border-white bg-neutral-900' : 'border-neutral-800/80'} rounded-2xl p-3 flex items-center justify-between cursor-pointer transition group">
                <div class="flex items-center space-x-3.5 min-w-0 flex-1">
                    ${isSelectMode ? `
                        <input type="checkbox" ${isSelected ? 'checked' : ''} class="w-4 h-4 accent-white pointer-events-none">
                    ` : `
                        <div class="w-11 h-14 bg-neutral-900 border border-neutral-800 rounded-xl flex flex-col items-center justify-center flex-shrink-0">
                            ${MONO_ICONS.pdfDoc}
                            <span class="text-[8px] font-bold text-neutral-500 mt-0.5 tracking-wider">PDF</span>
                        </div>
                    `}
                    <div class="min-w-0 flex-1">
                        <h4 class="text-sm font-semibold text-white truncate">${escapeHtml(p.title)}</h4>
                        <div class="flex items-center space-x-2 text-xs text-neutral-500 mt-1">
                            <span>${p.date}</span>
                            <span>•</span>
                            <span>${p.pages || 1} pages</span>
                            ${savedPageNum > 1 ? `<span class="text-neutral-200 font-semibold">• p.${savedPageNum}</span>` : ''}
                        </div>
                        ${folderObj && currentView !== 'folder' ? `
                            <span class="inline-flex items-center space-x-1.5 text-[10px] bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded-md mt-1 text-neutral-300">
                                <span class="w-2 h-2 rounded-full" style="background-color:${folderObj.color}"></span>
                                <span>${escapeHtml(folderObj.name)}</span>
                            </span>
                        ` : ''}
                    </div>
                </div>
                <div class="flex items-center space-x-1 ml-2">
                    <button onclick="event.stopPropagation(); toggleFavoriteBookFromList('${p.id}')" class="p-2 text-base ${p.isFav ? 'text-white' : 'text-neutral-600 hover:text-white'} transition" title="Favorite">${p.isFav ? '★' : '☆'}</button>
                    <button onclick="event.stopPropagation(); promptAssignFolder('${p.id}')" class="p-2 text-neutral-500 hover:text-white transition" title="Move to Folder">
                        ${MONO_ICONS.folder}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function handlePdfCardInteraction(pdfId) {
    if (isSelectMode) {
        if (selectedPdfIds.has(pdfId)) selectedPdfIds.delete(pdfId);
        else selectedPdfIds.add(pdfId);
        document.getElementById('selectedCountBadge').innerText = `${selectedPdfIds.size} selected`;
        renderWorkspace();
    } else {
        openReader(pdfId);
    }
}

function renderSidebarFolders() {
    const list = document.getElementById('sidebarFolderList');
    if (appData.folders.length === 0) {
        list.innerHTML = `<div class="text-neutral-600 text-xs px-2 py-2">No folders created yet</div>`;
        return;
    }
    list.innerHTML = appData.folders.map(f => {
        const count = appData.pdfs.filter(p => p.folderId === f.id).length;
        const isActive = currentView === 'folder' && activeFolderId === f.id;
        return `
            <div onclick="navigateView('folder', '${f.id}'); toggleSidebar(false);" class="flex items-center justify-between px-3 py-2.5 rounded-xl ${isActive ? 'bg-neutral-900 text-white font-semibold border border-neutral-800' : 'hover:bg-neutral-900/60 text-neutral-400'} cursor-pointer transition">
                <div class="flex items-center space-x-3 truncate">
                    <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-neutral-600" style="background-color: ${f.color}"></span>
                    <span class="text-sm truncate">${escapeHtml(f.name)}</span>
                </div>
                <span class="text-xs text-neutral-500 font-medium">${count}</span>
            </div>
        `;
    }).join('');
}

function renderQuotesList() {
    const container = document.getElementById('quotesSectionWrapper');
    if (appData.quotes.length === 0) {
        container.innerHTML = `
            <div class="bg-neutral-950 border border-neutral-900 rounded-3xl p-10 text-center space-y-2">
                <div class="text-2xl text-neutral-400">❝</div>
                <p class="text-sm font-medium text-neutral-300">No saved quotes yet</p>
                <p class="text-xs text-neutral-500">Highlight text while reading a PDF and tap "Save Quote".</p>
            </div>
        `;
        return;
    }

    container.innerHTML = appData.quotes.map((q, idx) => `
        <div class="bg-cardBg border border-neutral-800 rounded-2xl p-4 space-y-3">
            <p class="text-sm text-neutral-100 italic leading-relaxed select-text">“${escapeHtml(q.text)}”</p>
            <div class="flex items-center justify-between text-xs text-neutral-500 pt-2 border-t border-neutral-900">
                <span class="text-neutral-300 font-semibold truncate max-w-[200px]">${escapeHtml(q.bookName)} • p.${q.pageNo}</span>
                <div class="flex items-center space-x-3">
                    <button onclick="copyQuoteText(${idx})" class="text-neutral-400 hover:text-white font-medium">Copy</button>
                    <button onclick="deleteQuoteItem(${idx})" class="text-neutral-400 hover:text-white underline font-medium">Delete</button>
                </div>
            </div>
        </div>
    `).join('');
}

function renderTrashList() {
    const container = document.getElementById('trashItemsContainer');
    if (appData.trash.length === 0) {
        container.innerHTML = `<div class="text-center text-neutral-600 text-xs py-10">Trash is empty</div>`;
        return;
    }
    container.innerHTML = appData.trash.map((p, idx) => `
        <div class="bg-cardBg border border-neutral-800 rounded-2xl p-3 flex items-center justify-between">
            <div class="min-w-0 flex-1">
                <h4 class="text-sm font-semibold text-neutral-300 truncate">${escapeHtml(p.title)}</h4>
                <p class="text-xs text-neutral-500">${p.pages || 1} pages</p>
            </div>
            <div class="flex items-center space-x-2">
                <button onclick="restoreFromTrash(${idx})" class="px-3 py-1 bg-white text-black rounded-lg text-xs font-semibold">Restore</button>
                <button onclick="deletePermanently(${idx})" class="px-3 py-1 bg-neutral-900 border border-neutral-700 rounded-lg text-xs text-neutral-300 font-medium">Delete</button>
            </div>
        </div>
    `).join('');
}

function computeFitToScreenScale(page, mode) {
    const unscaledVp = page.getViewport({ scale: 1.0 });
    const viewer = document.getElementById('pdfViewerContainer');
    const availW = Math.max(280, (viewer.clientWidth || window.innerWidth) - 8);
    const availH = Math.max(360, (viewer.clientHeight || window.innerHeight) - 16);

    if (mode === 'vertical') {
        return availW / unscaledVp.width;
    } else {
        const scaleW = availW / unscaledVp.width;
        const scaleH = availH / unscaledVp.height;
        return Math.min(scaleW, scaleH);
    }
}

function getSafeRetinaDPR(viewportWidth, viewportHeight) {
    const rawDpr = Math.max(window.devicePixelRatio || 1, 2.75);
    const maxCanvasDim = 4096;
    const maxAllowedDprW = maxCanvasDim / Math.max(1, viewportWidth);
    const maxAllowedDprH = maxCanvasDim / Math.max(1, viewportHeight);
    return Math.max(1, Math.min(rawDpr, maxAllowedDprW, maxAllowedDprH));
}

function updateHorizontalCenteringMargins(width, height) {
    const horizArea = document.getElementById('horizontalSlideArea');
    const wrapper = document.getElementById('singlePageWrapper');
    horizArea.classList.remove('flex', 'items-center', 'justify-center', 'items-start', 'justify-start');
    horizArea.style.display = 'block';

    const availW = horizArea.clientWidth || window.innerWidth;
    const availH = horizArea.clientHeight || window.innerHeight;
    const marginX = Math.max(0, Math.floor((availW - width) / 2));
    const marginY = Math.max(0, Math.floor((availH - height) / 2));

    wrapper.style.marginLeft = `${marginX}px`;
    wrapper.style.marginTop = `${marginY}px`;
    wrapper.style.marginRight = `${marginX}px`;
    wrapper.style.marginBottom = `${marginY}px`;
}

async function openReader(pdfId) {
    const pdfMeta = appData.pdfs.find(p => p.id === pdfId);
    if (!pdfMeta) return;

    activePdfId = pdfId;
    currentView = 'reader';
    userZoomMultiplier = 1.0;
    isRestoringPosition = true;
    updateFitResetBadge();

    scrollDirection = appData.scrollDirection || 'horizontal';
    const horiz = document.getElementById('horizontalSlideArea');
    const vert = document.getElementById('verticalScrollArea');

    horiz.scrollTop = 0;
    horiz.scrollLeft = 0;
    vert.scrollTop = 0;
    vert.scrollLeft = 0;

    if (scrollDirection === 'vertical') {
        horiz.classList.add('hidden');
        vert.classList.remove('hidden');
    } else {
        vert.classList.add('hidden');
        horiz.classList.remove('hidden');
    }

    document.getElementById('readerBookTitle').innerText = pdfMeta.title;
    document.getElementById('readerMenuFavBtn').innerText = pdfMeta.isFav ? '★' : '☆';
    document.getElementById('readerScreen').classList.remove('hidden');

    const wrapper = document.getElementById('singlePageWrapper');
    if (isDarkModeInverted) wrapper.classList.add('invert-pdf');
    else wrapper.classList.remove('invert-pdf');

    const overlay = document.getElementById('globalLoadingOverlay');
    document.getElementById('loadingOverlayText').innerText = 'Opening book...';
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');

    try {
        const binaryData = await retrievePdfBinary(pdfId);
        if (!binaryData) {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
            showToast("Please re-upload this PDF file to read in this session.");
            closeReader();
            return;
        }

        const loadingTask = pdfjsLib.getDocument({ data: binaryData });
        activePdfDoc = await loadingTask.promise;
        totalReaderPages = activePdfDoc.numPages;

        const savedPage = parseInt(pdfMeta.lastPage, 10);
        currentReaderPage = (!isNaN(savedPage) && savedPage >= 1 && savedPage <= totalReaderPages) ? savedPage : 1;

        document.getElementById('totalPagesIndicator').innerText = totalReaderPages;
        document.getElementById('currentPageIndicator').innerText = currentReaderPage;
        const scrubber = document.getElementById('pageScrubberInput');
        scrubber.max = totalReaderPages;
        scrubber.value = currentReaderPage;

        if (scrollDirection === 'vertical') {
            await setupVerticalVirtualReader(false);
        } else {
            isRestoringPosition = false;
            await renderSingleHorizontalPage(currentReaderPage, false);
        }
    } catch (err) {
        isRestoringPosition = false;
        showToast("Could not render PDF file");
    } finally {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    }
}

function closeReader() {
    clearTimeout(sharpRenderDebounceTimer);
    if (activePdfDoc && scrollDirection === 'vertical') {
        detectCurrentVerticalPageFromCenterLine();
    }
    document.getElementById('readerScreen').classList.add('hidden');
    document.getElementById('quoteFloatingBtn').classList.add('hidden');
    if (verticalRenderObserver) {
        verticalRenderObserver.disconnect();
        verticalRenderObserver = null;
    }
    activePdfDoc = null;
    currentView = activeFolderId ? 'folder' : 'home';
    renderWorkspace();
}

async function renderSingleHorizontalPage(pageNum, preserveScroll = false) {
    if (!activePdfDoc) return;
    const validPage = Math.max(1, Math.min(totalReaderPages, parseInt(pageNum, 10) || 1));
    currentReaderPage = validPage;
    saveLastReadPage(validPage, 0);

    document.getElementById('currentPageIndicator').innerText = validPage;
    document.getElementById('pageScrubberInput').value = validPage;
    const zoomPct = Math.round(userZoomMultiplier * 100);
    document.getElementById('readerSubStatus').innerText = `${zoomPct === 100 ? 'Fit to Screen' : zoomPct + '% Zoom'} • Page ${validPage} of ${totalReaderPages}`;

    try {
        if (activeRenderTask) {
            try { activeRenderTask.cancel(); } catch (e) {}
        }

        const page = await activePdfDoc.getPage(validPage);
        baseFitScale = computeFitToScreenScale(page, 'horizontal');
        const fitVp = page.getViewport({ scale: baseFitScale });
        basePageWidth = fitVp.width;
        basePageHeight = fitVp.height;

        const finalCssScale = baseFitScale * userZoomMultiplier;
        const viewport = page.getViewport({ scale: finalCssScale });
        const dpr = getSafeRetinaDPR(viewport.width, viewport.height);

        const horizArea = document.getElementById('horizontalSlideArea');
        const wrapper = document.getElementById('singlePageWrapper');
        const canvas = document.getElementById('pdfCanvas');

        const savedScrollL = horizArea.scrollLeft;
        const savedScrollT = horizArea.scrollTop;

        const offCanvas = document.createElement('canvas');
        offCanvas.width = Math.floor(viewport.width * dpr);
        offCanvas.height = Math.floor(viewport.height * dpr);
        const offCtx = offCanvas.getContext('2d');

        activeRenderTask = page.render({
            canvasContext: offCtx,
            viewport: viewport,
            transform: [dpr, 0, 0, dpr, 0, 0]
        });
        await activeRenderTask.promise;

        wrapper.style.width = `${viewport.width}px`;
        wrapper.style.height = `${viewport.height}px`;
        updateHorizontalCenteringMargins(viewport.width, viewport.height);

        canvas.style.transform = 'none';
        canvas.width = offCanvas.width;
        canvas.height = offCanvas.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.getContext('2d').drawImage(offCanvas, 0, 0);

        if (preserveScroll) {
            horizArea.scrollLeft = savedScrollL;
            horizArea.scrollTop = savedScrollT;
        } else {
            horizArea.scrollLeft = 0;
            horizArea.scrollTop = 0;
        }

        const textLayerDiv = document.getElementById('singleTextLayer');
        textLayerDiv.innerHTML = '';
        textLayerDiv.style.display = 'block';
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.style.setProperty('--scale-factor', viewport.scale);

        const textContent = await page.getTextContent();
        await pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
        }).promise;

        if (validPage < totalReaderPages) {
            activePdfDoc.getPage(validPage + 1).catch(() => {});
        }
    } catch (e) {}
}

async function setupVerticalVirtualReader(inPlaceZoomUpdate = false) {
    if (!activePdfDoc) return;
    const vertArea = document.getElementById('verticalScrollArea');
    const zoomPct = Math.round(userZoomMultiplier * 100);
    document.getElementById('readerSubStatus').innerText = `Vertical (${zoomPct === 100 ? 'Fit Width' : zoomPct + '%'}) • ${totalReaderPages} Pages`;

    const firstPage = await activePdfDoc.getPage(1);
    baseFitScale = computeFitToScreenScale(firstPage, 'vertical');
    const fitVp = firstPage.getViewport({ scale: baseFitScale });
    basePageWidth = fitVp.width;
    basePageHeight = fitVp.height;

    const finalCssScale = baseFitScale * userZoomMultiplier;
    const defaultVp = firstPage.getViewport({ scale: finalCssScale });

    const existingSlots = vertArea.querySelectorAll('.virtual-page-slot');
    if (inPlaceZoomUpdate && existingSlots.length === totalReaderPages) {
        const savedScrollL = vertArea.scrollLeft;
        const savedScrollT = vertArea.scrollTop;

        existingSlots.forEach(slot => {
            slot.style.width = `${defaultVp.width}px`;
            slot.style.height = `${defaultVp.height}px`;
            const c = slot.querySelector('canvas');
            if (c) {
                c.style.width = `${defaultVp.width}px`;
                c.style.height = `${defaultVp.height}px`;
            }
            slot.dataset.rendered = 'false';
        });

        vertArea.scrollLeft = savedScrollL;
        vertArea.scrollTop = savedScrollT;

        const pagesToSharpen = [currentReaderPage, currentReaderPage - 1, currentReaderPage + 1];
        for (const pNum of pagesToSharpen) {
            if (pNum >= 1 && pNum <= totalReaderPages) {
                const slot = vertArea.querySelector(`.virtual-page-slot[data-page-number="${pNum}"]`);
                if (slot) {
                    slot.dataset.rendered = 'true';
                    renderVirtualPageSlot(pNum, slot);
                }
            }
        }
        return;
    }

    isRestoringPosition = true;
    vertArea.innerHTML = '';
    if (verticalRenderObserver) verticalRenderObserver.disconnect();

    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= totalReaderPages; i++) {
        const pageSlot = document.createElement('div');
        pageSlot.className = `virtual-page-slot pinch-zoom-target relative bg-white shadow-2xl mx-auto ${isDarkModeInverted ? 'invert-pdf' : ''}`;
        pageSlot.dataset.pageNumber = i;
        pageSlot.dataset.rendered = 'false';
        pageSlot.style.width = `${defaultVp.width}px`;
        pageSlot.style.height = `${defaultVp.height}px`;

        pageSlot.innerHTML = `
            <canvas id="vCanvas_${i}" class="block"></canvas>
            <div id="vText_${i}" class="textLayer"></div>
        `;
        fragment.appendChild(pageSlot);
    }
    vertArea.appendChild(fragment);

    verticalRenderObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const slot = entry.target;
                const pNum = parseInt(slot.dataset.pageNumber, 10);
                if (slot.dataset.rendered === 'false' && !isPinching) {
                    slot.dataset.rendered = 'true';
                    renderVirtualPageSlot(pNum, slot);
                }
            }
        });
    }, {
        root: vertArea,
        rootMargin: '600px 0px 600px 0px',
        threshold: 0.01
    });

    vertArea.querySelectorAll('.virtual-page-slot').forEach(slot => verticalRenderObserver.observe(slot));

    const pdfMeta = appData.pdfs.find(p => p.id === activePdfId);
    const targetPage = currentReaderPage;
    const savedRatio = (pdfMeta && pdfMeta.lastPage === targetPage && pdfMeta.lastPageOffsetRatio) ? pdfMeta.lastPageOffsetRatio : 0;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (targetPage <= 1 && savedRatio <= 0.02) {
                vertArea.scrollTop = 0;
            } else {
                const targetSlot = vertArea.querySelector(`.virtual-page-slot[data-page-number="${targetPage}"]`);
                if (targetSlot) {
                    const exactScrollY = targetSlot.offsetTop + (savedRatio * targetSlot.offsetHeight) - 64;
                    vertArea.scrollTop = Math.max(0, exactScrollY);
                }
            }

            const activeSlot = vertArea.querySelector(`.virtual-page-slot[data-page-number="${targetPage}"]`);
            if (activeSlot && activeSlot.dataset.rendered === 'false') {
                activeSlot.dataset.rendered = 'true';
                renderVirtualPageSlot(targetPage, activeSlot);
            }

            document.getElementById('currentPageIndicator').innerText = targetPage;
            document.getElementById('pageScrubberInput').value = targetPage;

            setTimeout(() => {
                isRestoringPosition = false;
            }, 120);
        });
    });
}

function handleVerticalScrollTracking() {
    if (currentView !== 'reader' || scrollDirection !== 'vertical' || isRestoringPosition || isPinching) return;
    if (!scrollTickScheduled) {
        scrollTickScheduled = true;
        requestAnimationFrame(() => {
            scrollTickScheduled = false;
            detectCurrentVerticalPageFromCenterLine();
        });
    }
}

function detectCurrentVerticalPageFromCenterLine() {
    if (!activePdfDoc || scrollDirection !== 'vertical' || isRestoringPosition) return;
    const vertArea = document.getElementById('verticalScrollArea');
    const slots = vertArea.querySelectorAll('.virtual-page-slot');
    if (slots.length === 0) return;

    const scrollTop = vertArea.scrollTop;
    const viewHeight = vertArea.clientHeight || window.innerHeight;

    if (scrollTop <= 20) {
        updateDetectedVerticalPage(1, 0);
        return;
    }

    if (scrollTop + viewHeight >= vertArea.scrollHeight - 20) {
        updateDetectedVerticalPage(totalReaderPages, 0);
        return;
    }

    const probeLineY = scrollTop + (viewHeight * 0.42);
    let bestPage = currentReaderPage;
    let bestOffsetRatio = 0;
    let minDistance = Infinity;

    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const top = slot.offsetTop;
        const height = slot.offsetHeight || basePageHeight || 500;
        const bottom = top + height;

        if (probeLineY >= top && probeLineY <= bottom) {
            bestPage = i + 1;
            bestOffsetRatio = Math.max(0, Math.min(0.95, (scrollTop + 64 - top) / height));
            minDistance = 0;
            break;
        }

        const centerDist = Math.abs(((top + bottom) / 2) - probeLineY);
        if (centerDist < minDistance) {
            minDistance = centerDist;
            bestPage = i + 1;
            bestOffsetRatio = 0;
        }
    }

    updateDetectedVerticalPage(bestPage, bestOffsetRatio);
}

function updateDetectedVerticalPage(pageNum, offsetRatio = 0) {
    const validPage = Math.max(1, Math.min(totalReaderPages, pageNum));
    if (validPage !== currentReaderPage) {
        currentReaderPage = validPage;
        document.getElementById('currentPageIndicator').innerText = validPage;
        document.getElementById('pageScrubberInput').value = validPage;
    }
    saveLastReadPage(validPage, offsetRatio);
}

async function renderVirtualPageSlot(pageNum, slotEl) {
    if (!activePdfDoc) return;
    try {
        const page = await activePdfDoc.getPage(pageNum);
        const fitScale = computeFitToScreenScale(page, 'vertical');
        const finalCssScale = fitScale * userZoomMultiplier;
        const vp = page.getViewport({ scale: finalCssScale });
        const dpr = getSafeRetinaDPR(vp.width, vp.height);

        const canvas = slotEl.querySelector('canvas');
        const textDiv = slotEl.querySelector('.textLayer');

        const offCanvas = document.createElement('canvas');
        offCanvas.width = Math.floor(vp.width * dpr);
        offCanvas.height = Math.floor(vp.height * dpr);

        await page.render({
            canvasContext: offCanvas.getContext('2d'),
            viewport: vp,
            transform: [dpr, 0, 0, dpr, 0, 0]
        }).promise;

        if (Math.abs(slotEl.offsetHeight - vp.height) > 2) {
            slotEl.style.height = `${vp.height}px`;
        }
        slotEl.style.width = `${vp.width}px`;

        canvas.width = offCanvas.width;
        canvas.height = offCanvas.height;
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;
        canvas.getContext('2d').drawImage(offCanvas, 0, 0);

        textDiv.innerHTML = '';
        textDiv.style.display = 'block';
        textDiv.style.width = `${vp.width}px`;
        textDiv.style.height = `${vp.height}px`;
        textDiv.style.setProperty('--scale-factor', vp.scale);

        const textContent = await page.getTextContent();
        await pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textDiv,
            viewport: vp,
            textDivs: []
        }).promise;
    } catch (e) {}
}

function saveLastReadPage(pageNum, offsetRatio = 0) {
    const p = appData.pdfs.find(x => x.id === activePdfId);
    if (p && pageNum >= 1 && pageNum <= totalReaderPages) {
        p.lastPage = pageNum;
        p.lastPageOffsetRatio = Number(offsetRatio.toFixed(3));
        saveMetadata();
    }
}

function scrollToVerticalPageExact(pageNum, smooth = false) {
    const vertArea = document.getElementById('verticalScrollArea');
    const validPage = Math.max(1, Math.min(totalReaderPages, parseInt(pageNum, 10) || 1));
    currentReaderPage = validPage;
    document.getElementById('currentPageIndicator').innerText = validPage;
    document.getElementById('pageScrubberInput').value = validPage;
    saveLastReadPage(validPage, 0);

    const slot = vertArea.querySelector(`.virtual-page-slot[data-page-number="${validPage}"]`);
    if (!slot) return;

    isRestoringPosition = true;
    const targetTop = validPage === 1 ? 0 : Math.max(0, slot.offsetTop - 56);
    vertArea.scrollTo({ top: targetTop, behavior: smooth ? 'smooth' : 'auto' });

    if (slot.dataset.rendered === 'false') {
        slot.dataset.rendered = 'true';
        renderVirtualPageSlot(validPage, slot);
    }

    setTimeout(() => {
        isRestoringPosition = false;
    }, smooth ? 350 : 80);
}

function resetZoomToFit() {
    userZoomMultiplier = 1.0;
    updateFitResetBadge();
    if (scrollDirection === 'vertical') setupVerticalVirtualReader(true);
    else renderSingleHorizontalPage(currentReaderPage, false);
}

function updateFitResetBadge() {
    const btn = document.getElementById('resetFitBtn');
    if (Math.abs(userZoomMultiplier - 1.0) > 0.03) {
        btn.classList.remove('hidden');
        btn.innerText = `${Math.round(userZoomMultiplier * 100)}% • Reset`;
    } else {
        btn.classList.add('hidden');
    }
}

function nextPage() {
    if (!activePdfDoc || currentReaderPage >= totalReaderPages) return;
    if (scrollDirection === 'vertical') {
        scrollToVerticalPageExact(currentReaderPage + 1, true);
    } else {
        userZoomMultiplier = 1.0;
        updateFitResetBadge();
        renderSingleHorizontalPage(currentReaderPage + 1, false);
    }
}

function prevPage() {
    if (!activePdfDoc || currentReaderPage <= 1) return;
    if (scrollDirection === 'vertical') {
        scrollToVerticalPageExact(currentReaderPage - 1, true);
    } else {
        userZoomMultiplier = 1.0;
        updateFitResetBadge();
        renderSingleHorizontalPage(currentReaderPage - 1, false);
    }
}

function scrubToPage(val) {
    const pageNum = parseInt(val, 10);
    if (!activePdfDoc || isNaN(pageNum)) return;
    if (scrollDirection === 'vertical') {
        scrollToVerticalPageExact(pageNum, false);
    } else {
        renderSingleHorizontalPage(pageNum, false);
    }
}

function jumpToPagePrompt() {
    const input = prompt(`Enter page number (1 - ${totalReaderPages}):`, currentReaderPage);
    if (!input) return;
    const num = parseInt(input, 10);
    if (num >= 1 && num <= totalReaderPages) scrubToPage(num);
    else showToast("Invalid page number");
}

function applyInstantLiveZoom(newZoom, focalScreenX, focalScreenY) {
    userZoomMultiplier = Math.min(4.0, Math.max(1.0, newZoom));
    updateFitResetBadge();

    const newW = basePageWidth * userZoomMultiplier;
    const newH = basePageHeight * userZoomMultiplier;

    if (scrollDirection === 'horizontal') {
        const horizArea = document.getElementById('horizontalSlideArea');
        const wrapper = document.getElementById('singlePageWrapper');
        const canvas = document.getElementById('pdfCanvas');
        const textLayer = document.getElementById('singleTextLayer');

        textLayer.style.display = 'none';

        wrapper.style.width = `${newW}px`;
        wrapper.style.height = `${newH}px`;
        canvas.style.width = `${newW}px`;
        canvas.style.height = `${newH}px`;

        updateHorizontalCenteringMargins(newW, newH);

        const areaRect = horizArea.getBoundingClientRect();
        const fingerLocalX = focalScreenX - areaRect.left;
        const fingerLocalY = focalScreenY - areaRect.top;

        const mLeft = parseFloat(wrapper.style.marginLeft) || 0;
        const mTop = parseFloat(wrapper.style.marginTop) || 0;

        horizArea.scrollLeft = Math.max(0, mLeft + (pinchDocPointX * userZoomMultiplier) - fingerLocalX);
        horizArea.scrollTop = Math.max(0, mTop + (pinchDocPointY * userZoomMultiplier) - fingerLocalY);
    } else {
        const vertArea = document.getElementById('verticalScrollArea');
        const areaRect = vertArea.getBoundingClientRect();
        const fingerLocalX = focalScreenX - areaRect.left;
        const fingerLocalY = focalScreenY - areaRect.top;

        vertArea.querySelectorAll('.virtual-page-slot').forEach(slot => {
            slot.style.width = `${newW}px`;
            slot.style.height = `${newH}px`;
            const c = slot.querySelector('canvas');
            if (c) {
                c.style.width = `${newW}px`;
                c.style.height = `${newH}px`;
            }
        });

        if (pinchTargetSlot) {
            const availW = vertArea.clientWidth || window.innerWidth;
            const slotLeft = Math.max(0, (availW - newW) / 2);
            vertArea.scrollLeft = Math.max(0, slotLeft + (pinchDocPointX * userZoomMultiplier) - fingerLocalX);
            vertArea.scrollTop = Math.max(0, pinchTargetSlot.offsetTop + (pinchDocPointY * userZoomMultiplier) - fingerLocalY);
        }
    }
}

function scheduleSharpCanvasReRender() {
    clearTimeout(sharpRenderDebounceTimer);
    sharpRenderDebounceTimer = setTimeout(async () => {
        if (isPinching || !activePdfDoc) return;
        if (scrollDirection === 'vertical') {
            await setupVerticalVirtualReader(true);
        } else {
            await renderSingleHorizontalPage(currentReaderPage, true);
        }
    }, 180);
}

function setupReaderGestures() {
    const viewer = document.getElementById('pdfViewerContainer');
    const wrapper = document.getElementById('singlePageWrapper');
    const vertArea = document.getElementById('verticalScrollArea');

    viewer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            clearTimeout(sharpRenderDebounceTimer);
            isPinching = true;

            pinchStartDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            pinchStartZoom = userZoomMultiplier;

            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

            if (scrollDirection === 'horizontal') {
                const rect = wrapper.getBoundingClientRect();
                pinchDocPointX = (midX - rect.left) / userZoomMultiplier;
                pinchDocPointY = (midY - rect.top) / userZoomMultiplier;
            } else {
                const elAtMid = document.elementFromPoint(midX, midY);
                pinchTargetSlot = elAtMid ? elAtMid.closest('.virtual-page-slot') : vertArea.querySelector(`.virtual-page-slot[data-page-number="${currentReaderPage}"]`);
                if (pinchTargetSlot) {
                    const rect = pinchTargetSlot.getBoundingClientRect();
                    pinchDocPointX = (midX - rect.left) / userZoomMultiplier;
                    pinchDocPointY = (midY - rect.top) / userZoomMultiplier;
                }
            }
        } else if (e.touches.length === 1 && !isPinching) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }
    }, { passive: true });

    viewer.addEventListener('touchmove', (e) => {
        if (isPinching && e.touches.length === 2 && pinchStartDist > 0) {
            e.preventDefault();
            const currentDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

            const newZoom = pinchStartZoom * (currentDist / pinchStartDist);
            applyInstantLiveZoom(newZoom, midX, midY);
        }
    }, { passive: false });

    viewer.addEventListener('touchend', (e) => {
        if (isPinching && e.touches.length < 2) {
            isPinching = false;
            pinchStartDist = 0;
            if (userZoomMultiplier < 1.04) {
                userZoomMultiplier = 1.0;
                updateFitResetBadge();
            }
            scheduleSharpCanvasReRender();
            return;
        }

        if (e.changedTouches.length === 1 && !isPinching) {
            const now = Date.now();
            const tapX = e.changedTouches[0].clientX;
            const tapY = e.changedTouches[0].clientY;
            const dx = touchStartX - tapX;
            const dy = Math.abs(touchStartY - tapY);

            if (Math.abs(dx) < 15 && dy < 15) {
                if (now - lastTapTimestamp < 280) {
                    if (scrollDirection === 'horizontal') {
                        const rect = wrapper.getBoundingClientRect();
                        pinchDocPointX = (tapX - rect.left) / userZoomMultiplier;
                        pinchDocPointY = (tapY - rect.top) / userZoomMultiplier;
                    } else {
                        const elAtTap = document.elementFromPoint(tapX, tapY);
                        pinchTargetSlot = elAtTap ? elAtTap.closest('.virtual-page-slot') : vertArea.querySelector(`.virtual-page-slot[data-page-number="${currentReaderPage}"]`);
                        if (pinchTargetSlot) {
                            const rect = pinchTargetSlot.getBoundingClientRect();
                            pinchDocPointX = (tapX - rect.left) / userZoomMultiplier;
                            pinchDocPointY = (tapY - rect.top) / userZoomMultiplier;
                        }
                    }

                    const nextZoom = userZoomMultiplier > 1.08 ? 1.0 : 2.25;
                    applyInstantLiveZoom(nextZoom, tapX, tapY);
                    scheduleSharpCanvasReRender();
                    lastTapTimestamp = 0;
                    return;
                }
                lastTapTimestamp = now;
            }

            if (scrollDirection === 'horizontal' && userZoomMultiplier <= 1.03) {
                const sel = window.getSelection();
                if (sel && sel.toString().trim().length > 0) return;

                if (Math.abs(dx) > 55 && dy < 90) {
                    if (dx > 0) nextPage();
                    else prevPage();
                }
            }
        }
    }, { passive: true });

    viewer.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            if (scrollDirection === 'horizontal') {
                const rect = wrapper.getBoundingClientRect();
                pinchDocPointX = (e.clientX - rect.left) / userZoomMultiplier;
                pinchDocPointY = (e.clientY - rect.top) / userZoomMultiplier;
            } else {
                const elAtCursor = document.elementFromPoint(e.clientX, e.clientY);
                pinchTargetSlot = elAtCursor ? elAtCursor.closest('.virtual-page-slot') : vertArea.querySelector(`.virtual-page-slot[data-page-number="${currentReaderPage}"]`);
                if (pinchTargetSlot) {
                    const rect = pinchTargetSlot.getBoundingClientRect();
                    pinchDocPointX = (e.clientX - rect.left) / userZoomMultiplier;
                    pinchDocPointY = (e.clientY - rect.top) / userZoomMultiplier;
                }
            }

            const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
            applyInstantLiveZoom(userZoomMultiplier * zoomFactor, e.clientX, e.clientY);
            scheduleSharpCanvasReRender();
            return;
        }
        if (scrollDirection === 'horizontal' && userZoomMultiplier <= 1.03) {
            if (Math.abs(e.deltaY) > 25) {
                if (e.deltaY > 0) nextPage();
                else prevPage();
            }
        }
    }, { passive: false });
}

function handleReaderTap(e) {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;

    const topBar = document.getElementById('readerTopBar');
    const bottomBar = document.getElementById('readerBottomBar');
    readerUiVisible = !readerUiVisible;

    if (readerUiVisible) {
        topBar.style.transform = 'translateY(0)';
        bottomBar.style.opacity = '1';
        bottomBar.style.pointerEvents = 'auto';
    } else {
        topBar.style.transform = 'translateY(-100%)';
        bottomBar.style.opacity = '0';
        bottomBar.style.pointerEvents = 'none';
    }
}

function handleTextSelectionChange() {
    if (currentView !== 'reader') return;
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    const btn = document.getElementById('quoteFloatingBtn');

    if (text.length > 1) {
        cachedSelectedText = text;
        try {
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const topPos = Math.max(70, rect.top - 48);
            const leftPos = Math.min(window.innerWidth - 130, Math.max(16, rect.left + (rect.width / 2) - 55));
            btn.style.top = `${topPos}px`;
            btn.style.left = `${leftPos}px`;
            btn.classList.remove('hidden');
        } catch (e) {
            btn.style.top = '80px';
            btn.style.left = '50%';
            btn.classList.remove('hidden');
        }
    } else {
        btn.classList.add('hidden');
    }
}

function openQuoteModalWithSelection() {
    const textarea = document.getElementById('quoteEditTextarea');
    textarea.value = cachedSelectedText || '';
    document.getElementById('quoteModal').classList.remove('hidden');
    document.getElementById('quoteFloatingBtn').classList.add('hidden');
}

async function loadFullPageTextIntoQuote() {
    if (!activePdfDoc) return;
    try {
        const page = await activePdfDoc.getPage(currentReaderPage);
        const content = await page.getTextContent();
        const fullText = content.items.map(item => item.str).join(' ');
        document.getElementById('quoteEditTextarea').value = fullText;
        showToast(`Loaded text from Page ${currentReaderPage}`);
    } catch (e) {
        showToast("Could not extract text");
    }
}

function closeQuoteModal() { document.getElementById('quoteModal').classList.add('hidden'); }

function saveQuoteConfirmed() {
    const text = document.getElementById('quoteEditTextarea').value.trim();
    if (!text) return showToast("Enter quote text");
    const book = appData.pdfs.find(p => p.id === activePdfId);
    appData.quotes.unshift({
        id: 'q_' + Date.now(),
        text: text,
        bookName: book ? book.title : 'PDF Document',
        pageNo: currentReaderPage,
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    });
    cachedSelectedText = '';
    if (window.getSelection) window.getSelection().removeAllRanges();
    saveMetadata();
    closeQuoteModal();
    showToast("Quote saved");
}

function copyQuoteText(idx) {
    const q = appData.quotes[idx];
    if (!q) return;
    navigator.clipboard.writeText(`"${q.text}" — ${q.bookName} (Page ${q.pageNo})`);
    showToast("Copied to clipboard");
}

function deleteQuoteItem(idx) {
    appData.quotes.splice(idx, 1);
    saveMetadata();
    renderWorkspace();
    showToast("Quote removed");
}

function openReaderSearchModal() {
    document.getElementById('readerSearchModal').classList.remove('hidden');
    document.getElementById('pdfInternalSearchInput').focus();
}

function closeReaderSearchModal() { document.getElementById('readerSearchModal').classList.add('hidden'); }

async function executePdfInternalSearch() {
    const query = document.getElementById('pdfInternalSearchInput').value.trim().toLowerCase();
    const resultsBox = document.getElementById('pdfSearchResultsList');
    if (!query || !activePdfDoc) return;

    resultsBox.innerHTML = `<p class="text-xs text-neutral-400 text-center py-4">Searching ${totalReaderPages} pages...</p>`;
    const matches = [];

    for (let i = 1; i <= totalReaderPages; i++) {
        try {
            const page = await activePdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(it => it.str).join(' ');
            const lower = pageText.toLowerCase();
            const idx = lower.indexOf(query);
            if (idx !== -1) {
                const snippet = pageText.substring(Math.max(0, idx - 30), Math.min(pageText.length, idx + query.length + 50));
                matches.push({ page: i, snippet: snippet });
            }
        } catch (e) {}
    }

    if (matches.length === 0) {
        resultsBox.innerHTML = `<p class="text-xs text-neutral-400 text-center py-4">No matches found</p>`;
        return;
    }

    resultsBox.innerHTML = matches.map(m => `
        <div onclick="closeReaderSearchModal(); scrubToPage(${m.page});" class="bg-neutral-900 border border-neutral-800 hover:border-neutral-600 p-3 rounded-xl cursor-pointer transition">
            <div class="text-xs font-bold text-white mb-1">Page ${m.page}</div>
            <p class="text-xs text-neutral-400 line-clamp-2">...${escapeHtml(m.snippet)}...</p>
        </div>
    `).join('');
}

function toggleDarkModeInvert() {
    isDarkModeInverted = !isDarkModeInverted;
    appData.isDarkModeInverted = isDarkModeInverted;
    saveMetadata();

    const wrapper = document.getElementById('singlePageWrapper');
    const btn = document.getElementById('darkModeToggleBtn');

    if (isDarkModeInverted) {
        wrapper.classList.add('invert-pdf');
        document.querySelectorAll('.virtual-page-slot').forEach(el => el.classList.add('invert-pdf'));
        btn.innerHTML = MONO_ICONS.sun;
        showToast("Inverted Dark Mode On");
    } else {
        wrapper.classList.remove('invert-pdf');
        document.querySelectorAll('.virtual-page-slot').forEach(el => el.classList.remove('invert-pdf'));
        btn.innerHTML = MONO_ICONS.moon;
        showToast("Original Page Colors On");
    }
}

function openPageSettingsModal() {
    document.getElementById('btnScrollVert').className = `py-2.5 border rounded-xl text-sm font-semibold transition ${scrollDirection === 'vertical' ? 'border-white bg-white text-black' : 'border-neutral-800 text-neutral-400'}`;
    document.getElementById('btnScrollHoriz').className = `py-2.5 border rounded-xl text-sm font-semibold transition ${scrollDirection === 'horizontal' ? 'border-white bg-white text-black' : 'border-neutral-800 text-neutral-400'}`;
    document.getElementById('pageSettingsModal').classList.remove('hidden');
}

function closePageSettingsModal() { document.getElementById('pageSettingsModal').classList.add('hidden'); }

async function setScrollDirection(dir) {
    scrollDirection = dir;
    appData.scrollDirection = dir;
    saveMetadata();

    const defaultScrollEl = document.getElementById('defaultScrollSelect');
    if (defaultScrollEl) defaultScrollEl.value = dir;

    userZoomMultiplier = 1.0;
    updateFitResetBadge();
    const horiz = document.getElementById('horizontalSlideArea');
    const vert = document.getElementById('verticalScrollArea');

    if (dir === 'vertical') {
        horiz.classList.add('hidden');
        vert.classList.remove('hidden');
        if (activePdfDoc) await setupVerticalVirtualReader(false);
    } else {
        vert.classList.add('hidden');
        horiz.classList.remove('hidden');
        if (activePdfDoc) await renderSingleHorizontalPage(currentReaderPage, false);
    }
    closePageSettingsModal();
    showToast(`Default scroll set to ${dir}`);
}

function setReaderBg(color) {
    appData.readerBgColor = color;
    saveMetadata();
    document.getElementById('pdfViewerContainer').style.backgroundColor = color;
    closePageSettingsModal();
}

function openCreateFolderModal() {
    document.getElementById('newFolderNameInput').value = '';
    selectedFolderColor = '#4273E3';
    const circles = document.querySelectorAll('#folderColorPicker div');
    circles.forEach((d, idx) => {
        if (idx === 0) d.classList.add('ring-2', 'ring-white');
        else d.classList.remove('ring-2', 'ring-white');
    });
    document.getElementById('createFolderModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('newFolderNameInput').focus(), 50);
}
function closeCreateFolderModal() { document.getElementById('createFolderModal').classList.add('hidden'); }

function selectFolderColor(color, el) {
    selectedFolderColor = color;
    document.querySelectorAll('#folderColorPicker div').forEach(d => d.classList.remove('ring-2', 'ring-white'));
    el.classList.add('ring-2', 'ring-white');
}

function confirmCreateFolder() {
    const name = document.getElementById('newFolderNameInput').value.trim();
    if (!name) return showToast("Enter a folder name");
    appData.folders.push({
        id: 'folder_' + Date.now(),
        name: name,
        color: selectedFolderColor
    });
    saveMetadata();
    renderWorkspace();
    closeCreateFolderModal();
    showToast(`Folder "${name}" created`);
}

function openManageFoldersModal() {
    const box = document.getElementById('manageFoldersListContainer');
    if (appData.folders.length === 0) {
        box.innerHTML = `<p class="text-xs text-neutral-500 text-center py-4">No folders created yet</p>`;
    } else {
        box.innerHTML = appData.folders.map(f => `
            <div class="flex items-center justify-between p-3 bg-neutral-900 border border-neutral-800 rounded-xl">
                <div class="flex items-center space-x-2.5 truncate">
                    <span class="w-3 h-3 rounded-full border border-neutral-600" style="background-color:${f.color}"></span>
                    <span class="text-sm font-medium text-white truncate">${escapeHtml(f.name)}</span>
                </div>
                <div class="flex items-center space-x-3">
                    <button onclick="renameFolderPrompt('${f.id}')" class="text-xs text-neutral-300 hover:text-white font-semibold">Rename</button>
                    <button onclick="deleteFolderById('${f.id}')" class="text-xs text-neutral-400 hover:text-white underline font-semibold">Delete</button>
                </div>
            </div>
        `).join('');
    }
    document.getElementById('manageFoldersModal').classList.remove('hidden');
}
function closeManageFoldersModal() { document.getElementById('manageFoldersModal').classList.add('hidden'); }

function renameFolderPrompt(folderId) {
    const f = appData.folders.find(x => x.id === folderId);
    if (!f) return;
    const nextName = prompt("Rename folder:", f.name);
    if (nextName && nextName.trim()) {
        f.name = nextName.trim();
        saveMetadata();
        renderWorkspace();
        openManageFoldersModal();
    }
}

function deleteFolderById(folderId) {
    appData.folders = appData.folders.filter(f => f.id !== folderId);
    appData.pdfs.forEach(p => { if (p.folderId === folderId) p.folderId = null; });
    if (activeFolderId === folderId) activeFolderId = null;
    saveMetadata();
    renderWorkspace();
    openManageFoldersModal();
    showToast("Folder deleted");
}

function promptAssignFolder(pdfId) {
    isBulkMove = false;
    activePdfId = pdfId;
    populateAssignFolderModal();
}

function promptBulkMoveFolder() {
    if (selectedPdfIds.size === 0) return showToast("Select books first");
    isBulkMove = true;
    populateAssignFolderModal();
}

function populateAssignFolderModal() {
    const box = document.getElementById('assignFolderListContainer');
    let html = `<div onclick="executeFolderAssignment(null)" class="p-3 bg-neutral-900 border border-neutral-800 hover:border-neutral-600 rounded-xl cursor-pointer text-sm font-medium">Main Library (None)</div>`;
    html += appData.folders.map(f => `
        <div onclick="executeFolderAssignment('${f.id}')" class="p-3 bg-neutral-900 border border-neutral-800 hover:border-neutral-600 rounded-xl cursor-pointer text-sm font-medium flex items-center space-x-2.5">
            <span class="w-3 h-3 rounded-full border border-neutral-600" style="background-color:${f.color}"></span>
            <span>${escapeHtml(f.name)}</span>
        </div>
    `).join('');
    box.innerHTML = html;
    document.getElementById('assignFolderModal').classList.remove('hidden');
}
function closeAssignFolderModal() { document.getElementById('assignFolderModal').classList.add('hidden'); }

function executeFolderAssignment(folderId) {
    if (isBulkMove) {
        appData.pdfs.forEach(p => { if (selectedPdfIds.has(p.id)) p.folderId = folderId; });
        exitSelectMode();
    } else {
        const p = appData.pdfs.find(x => x.id === activePdfId);
        if (p) p.folderId = folderId;
    }
    saveMetadata();
    renderWorkspace();
    closeAssignFolderModal();
    showToast("Moved successfully");
}

function enterSelectMode() {
    isSelectMode = true;
    selectedPdfIds.clear();
    document.getElementById('multiSelectBar').classList.remove('hidden');
    document.getElementById('selectedCountBadge').innerText = '0 selected';
    renderWorkspace();
}
function exitSelectMode() {
    isSelectMode = false;
    selectedPdfIds.clear();
    document.getElementById('multiSelectBar').classList.add('hidden');
    renderWorkspace();
}
function selectAllPdfs() {
    appData.pdfs.forEach(p => selectedPdfIds.add(p.id));
    document.getElementById('selectedCountBadge').innerText = `${selectedPdfIds.size} selected`;
    renderWorkspace();
}
function bulkDeleteSelected() {
    if (selectedPdfIds.size === 0) return;
    const remaining = [];
    appData.pdfs.forEach(p => {
        if (selectedPdfIds.has(p.id)) appData.trash.unshift(p);
        else remaining.push(p);
    });
    appData.pdfs = remaining;
    saveMetadata();
    exitSelectMode();
    showToast("Moved to Trash");
}

function toggleFavoriteBookFromList(pdfId) {
    const p = appData.pdfs.find(x => x.id === pdfId);
    if (!p) return;
    p.isFav = !p.isFav;
    saveMetadata();
    renderWorkspace();
}

function toggleFavoriteActiveBook() {
    const p = appData.pdfs.find(x => x.id === activePdfId);
    if (!p) return;
    p.isFav = !p.isFav;
    document.getElementById('readerMenuFavBtn').innerText = p.isFav ? '★' : '☆';
    saveMetadata();
    showToast(p.isFav ? "Added to Favorites" : "Removed from Favorites");
}

function openSortModal() { document.getElementById('sortModal').classList.remove('hidden'); }
function closeSortModal() { document.getElementById('sortModal').classList.add('hidden'); }
function applySortOrder(order) {
    appData.sortBy = order;
    const labels = { dateDesc: 'Sort: Latest', titleAsc: 'Sort: A-Z', titleDesc: 'Sort: Z-A', pagesDesc: 'Sort: Pages' };
    document.getElementById('sortIndicatorLabel').innerHTML = `<span>${labels[order]}</span>`;
    saveMetadata();
    renderWorkspace();
    closeSortModal();
}

function toggleLayoutViewMode() {
    appData.viewMode = appData.viewMode === 'list' ? 'grid' : 'list';
    document.getElementById('viewModeMenuLabel').innerText = appData.viewMode === 'list' ? 'Grid View' : 'List View';
    saveMetadata();
    renderWorkspace();
}

function deleteActiveBook() {
    const idx = appData.pdfs.findIndex(p => p.id === activePdfId);
    if (idx !== -1) {
        const removed = appData.pdfs.splice(idx, 1)[0];
        appData.trash.unshift(removed);
        saveMetadata();
        toggleReaderMenu(false);
        closeReader();
        showToast("Moved to Trash");
    }
}

function restoreFromTrash(idx) {
    const item = appData.trash.splice(idx, 1)[0];
    if (item) appData.pdfs.unshift(item);
    saveMetadata();
    renderWorkspace();
    showToast("Book restored");
}

async function deletePermanently(idx) {
    const item = appData.trash.splice(idx, 1)[0];
    if (item) await removePdfBinary(item.id);
    saveMetadata();
    renderWorkspace();
    showToast("Deleted permanently");
}

async function emptyTrashBin() {
    for (const item of appData.trash) {
        await removePdfBinary(item.id);
    }
    appData.trash = [];
    saveMetadata();
    renderWorkspace();
    showToast("Trash emptied");
}

function toggleSidebar(open) {
    const drawer = document.getElementById('sidebarDrawer');
    const backdrop = document.getElementById('drawerBackdrop');
    if (open) {
        backdrop.classList.remove('hidden');
        setTimeout(() => backdrop.style.opacity = '1', 10);
        drawer.classList.remove('-translate-x-full');
    } else {
        drawer.classList.add('-translate-x-full');
        backdrop.style.opacity = '0';
        setTimeout(() => backdrop.classList.add('hidden'), 300);
    }
}

function toggleSearchBar(show) {
    const wrap = document.getElementById('searchBarWrapper');
    if (show) {
        wrap.classList.remove('hidden');
        document.getElementById('globalSearchInput').focus();
    } else {
        wrap.classList.add('hidden');
        document.getElementById('globalSearchInput').value = '';
        renderWorkspace();
    }
}

function handleGlobalSearch(q) {
    const query = q.toLowerCase().trim();
    if (!query) return renderWorkspace();
    const filtered = appData.pdfs.filter(p => p.title.toLowerCase().includes(query));
    renderPdfCollection(filtered);
}

function toggleHomeMenu(open) {
    const m = document.getElementById('homeMenuModal');
    if (open) m.classList.remove('hidden'); else m.classList.add('hidden');
}

function toggleReaderMenu(open) {
    const m = document.getElementById('readerMenuModal');
    if (open) m.classList.remove('hidden'); else m.classList.add('hidden');
}

function openSettingsModal() {
    const defaultScrollEl = document.getElementById('defaultScrollSelect');
    if (defaultScrollEl) defaultScrollEl.value = scrollDirection;
    document.getElementById('settingsModal').classList.remove('hidden');
}
function closeSettingsModal() { document.getElementById('settingsModal').classList.add('hidden'); }

function shareActiveBook() {
    const p = appData.pdfs.find(x => x.id === activePdfId);
    if (p && navigator.share) {
        navigator.share({ title: p.title, text: `Reading "${p.title}" on ReadIT` }).catch(() => {});
    } else {
        showToast("Title copied to clipboard");
    }
}

function printActiveBook() {
    toggleReaderMenu(false);
    window.print();
}

function clearAllData() {
    if (!confirm("Reset all folders, PDFs, and saved quotes in ReadIT?")) return;
    try { localStorage.removeItem('samsung_reader_meta_v2'); } catch(e) {}
    memoryPdfStore.clear();
    appData = { folders: [], pdfs: [], quotes: [], trash: [], sortBy: 'dateDesc', viewMode: 'list', scrollDirection: 'horizontal', readerBgColor: '#000000', isDarkModeInverted: false, isAppInstalled: false };
    scrollDirection = 'horizontal';
    isDarkModeInverted = false;
    navigateView('home');
    showToast("All ReadIT data reset");
}

function showToast(msg) {
    const t = document.getElementById('toast');
    document.getElementById('toastText').innerText = msg;
    t.style.opacity = '1';
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2600);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
