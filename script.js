const READIT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="115" fill="#FFFFFF"/><g transform="translate(46, 36) scale(3.5)"><rect x="14" y="8" width="22" height="75" rx="5" fill="#1C3F7A"/><path d="M25 8h6a5 5 0 0 1 5 5v65a5 5 0 0 1-5 5h-6V8z" fill="#132C58"/><rect x="14" y="18" width="22" height="4" fill="#E5E9F0"/><rect x="14" y="26" width="22" height="4" fill="#E5E9F0"/><rect x="14" y="68" width="22" height="4.5" fill="#E5E9F0"/><rect x="42" y="8" width="22" height="75" rx="5" fill="#122B4A"/><path d="M53 8h6a5 5 0 0 1 5 5v65a5 5 0 0 1-5 5h-6V8z" fill="#0B1B30"/><rect x="42" y="18" width="22" height="4" fill="#E5E9F0"/><rect x="42" y="26" width="22" height="4" fill="#E5E9F0"/><rect x="42" y="68" width="22" height="4.5" fill="#E5E9F0"/><g transform="rotate(-12 85 45)"><rect x="74" y="8" width="22" height="75" rx="5" fill="#0D233D"/><path d="M85 8h6a5 5 0 0 1 5 5v65a5 5 0 0 1-5 5h-6V8z" fill="#0F3A5D"/><rect x="74" y="18" width="22" height="4" fill="#E5E9F0"/><rect x="74" y="26" width="22" height="4" fill="#E5E9F0"/><rect x="74" y="68" width="22" height="4.5" fill="#E5E9F0"/></g><text x="60" y="114" font-family="Arial, sans-serif" font-weight="900" font-size="27" text-anchor="middle"><tspan fill="#0B1F3A">Read</tspan><tspan fill="#2193E6">IT</tspan></text></g></svg>`;

let appData = {
    folders: [],
    pdfs: [],
    quotes: [],
    trash: [],
    sortBy: 'dateDesc',
    viewMode: 'list',
    isAppInstalled: false
};

const memoryPdfStore = new Map();

let currentView = 'home';
let activeFolderId = null;
let activePdfId = null;
let selectedFolderColor = '#7A635B';
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
let userZoomMultiplier = 1.0;
let verticalObserver = null;
let activeRenderTask = null;

let touchStartX = 0;
let touchStartY = 0;
let isPinching = false;
let initialPinchDist = null;
let livePinchMultiplier = 1.0;
let lastTapTimestamp = 0;
let deferredInstallPrompt = null;

let db = null;
const DB_NAME = 'ReadIT_PDFReaderDB_v2';
const STORE_NAME = 'pdfBinaryStore';

function initDatabase() {
    return new Promise((resolve) => {
        try {
            if (!window.indexedDB) {
                document.getElementById('storageEngineStatus').innerText = 'RAM Mode (Sandbox)';
                return resolve(null);
            }
            const request = indexedDB.open(DB_NAME, 1);
            request.onerror = () => {
                document.getElementById('storageEngineStatus').innerText = 'RAM Mode (Fallback)';
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
        }
        appData.isAppInstalled = localStorage.getItem('samsung_pwa_hidden') === 'true' || window.matchMedia('(display-mode: standalone)').matches;
    } catch (e) {}

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
            viewMode: appData.viewMode
        }));
    } catch (e) {}
}

function setupDynamicPWA() {
    try {
        const iconUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(READIT_LOGO_SVG);
        const fav = document.createElement('link');
        fav.rel = 'icon';
        fav.href = iconUrl;
        document.head.appendChild(fav);

        const appleIcon = document.createElement('link');
        appleIcon.rel = 'apple-touch-icon';
        appleIcon.href = iconUrl;
        document.head.appendChild(appleIcon);

        const manifest = {
            name: "ReadIT",
            short_name: "ReadIT",
            description: "ReadIT - Minimal One UI AMOLED PDF Reader & Quote Saver",
            start_url: window.location.href,
            display: "standalone",
            background_color: "#000000",
            theme_color: "#000000",
            icons: [{
                src: iconUrl,
                sizes: "512x512",
                type: "image/svg+xml",
                purpose: "any maskable"
            }]
        };
        const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = URL.createObjectURL(blob);
        document.head.appendChild(link);
    } catch (e) {}

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
    });

    window.addEventListener('appinstalled', () => {
        closePWAInstallModal(true);
        showToast("ReadIT installed successfully!");
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

window.addEventListener('DOMContentLoaded', async () => {
    setupDynamicPWA();
    await initDatabase();
    loadMetadata();
    renderWorkspace();

    const fileInput = document.getElementById('pdfFileInput');
    fileInput.addEventListener('change', handleFileInputSelection);

    setupReaderGestures();
    document.addEventListener('selectionchange', handleTextSelectionChange);

    window.addEventListener('resize', () => {
        if (currentView === 'reader' && activePdfDoc && userZoomMultiplier === 1.0) {
            if (scrollDirection === 'vertical') setupVerticalVirtualReader();
            else renderSingleHorizontalPage(currentReaderPage);
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
        showToast("PDF imported! Opening reader...");
        openReader(lastAddedId);
    } else if (addedCount > 1) {
        showToast(`${addedCount} PDFs imported successfully!`);
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
        if (el) el.className = "flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-neutral-800/60 text-neutral-200 cursor-pointer transition";
    });
    const activeMap = { home: 'navItemAll', favorites: 'navItemFav', quotes: 'navItemQuotes', trash: 'navItemTrash' };
    if (activeMap[currentView]) {
        document.getElementById(activeMap[currentView]).className = "flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-neutral-800 text-white font-semibold cursor-pointer transition";
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
            <div onclick="openCreateFolderModal()" class="col-span-full border border-dashed border-neutral-800 hover:border-neutral-700 rounded-2xl p-5 text-center cursor-pointer transition">
                <p class="text-xs text-neutral-400">+ Tap to create your first folder</p>
            </div>
        `;
        return;
    }

    container.innerHTML = appData.folders.map(f => {
        const count = appData.pdfs.filter(p => p.folderId === f.id).length;
        return `
            <div onclick="navigateView('folder', '${f.id}')" class="bg-cardBg hover:bg-cardHover border border-neutral-800/80 rounded-2xl p-3.5 flex flex-col justify-between h-28 cursor-pointer transition active:scale-95 relative overflow-hidden group">
                <div class="absolute top-0 left-0 right-0 h-7 transition-all group-hover:h-8" style="background-color: ${f.color}"></div>
                <div class="flex items-center justify-between mt-5 z-10">
                    <span class="text-xs font-semibold text-neutral-400">${count}</span>
                    <span class="text-xs opacity-60">📁</span>
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
            <div class="bg-neutral-900/40 border border-neutral-800/60 rounded-3xl p-10 text-center space-y-3">
                <div class="text-3xl">📄</div>
                <p class="text-sm font-medium text-neutral-300">No PDF books found here</p>
                <p class="text-xs text-neutral-500">Tap the <b class="text-white">PDF+</b> button above to import PDFs from your device.</p>
            </div>
        `;
        return;
    }

    container.className = appData.viewMode === 'grid' ? "grid grid-cols-2 sm:grid-cols-3 gap-3" : "space-y-2.5";

    container.innerHTML = sorted.map(p => {
        const folderObj = appData.folders.find(f => f.id === p.folderId);
        const isSelected = selectedPdfIds.has(p.id);

        if (appData.viewMode === 'grid') {
            return `
                <div onclick="handlePdfCardInteraction('${p.id}')" class="bg-cardBg hover:bg-cardHover border ${isSelected ? 'border-samsungBlue ring-2 ring-samsungBlue' : 'border-neutral-800/80'} rounded-2xl p-4 flex flex-col justify-between h-40 cursor-pointer transition relative">
                    <div class="flex items-start justify-between">
                        <div class="w-10 h-12 bg-neutral-800 border border-neutral-700 rounded-lg flex items-center justify-center text-lg">📕</div>
                        <button onclick="event.stopPropagation(); toggleFavoriteBookFromList('${p.id}')" class="text-base ${p.isFav ? 'text-yellow-400' : 'text-neutral-600 hover:text-white'}">${p.isFav ? '★' : '☆'}</button>
                    </div>
                    <div>
                        <h4 class="text-xs sm:text-sm font-bold text-white line-clamp-2">${escapeHtml(p.title)}</h4>
                        <p class="text-[11px] text-neutral-400 mt-1">${p.pages || 1} pages • ${p.size || 'PDF'}</p>
                    </div>
                </div>
            `;
        }

        return `
            <div onclick="handlePdfCardInteraction('${p.id}')" class="bg-cardBg hover:bg-cardHover border ${isSelected ? 'border-samsungBlue bg-blue-950/20' : 'border-neutral-800/70'} rounded-2xl p-3 flex items-center justify-between cursor-pointer transition group">
                <div class="flex items-center space-x-3.5 min-w-0 flex-1">
                    ${isSelectMode ? `
                        <input type="checkbox" ${isSelected ? 'checked' : ''} class="w-4 h-4 accent-samsungBlue pointer-events-none">
                    ` : `
                        <div class="w-11 h-14 bg-neutral-800 border border-neutral-700/80 rounded-xl flex flex-col items-center justify-center shadow-inner flex-shrink-0">
                            <span class="text-base">📕</span>
                            <span class="text-[9px] font-bold text-neutral-400 mt-0.5">PDF</span>
                        </div>
                    `}
                    <div class="min-w-0 flex-1">
                        <h4 class="text-sm font-semibold text-white truncate">${escapeHtml(p.title)}</h4>
                        <div class="flex items-center space-x-2 text-xs text-neutral-400 mt-1">
                            <span>${p.date}</span>
                            <span>•</span>
                            <span>${p.pages || 1} pages</span>
                            ${p.lastPage > 1 ? `<span class="text-samsungBlue font-medium">• p.${p.lastPage}</span>` : ''}
                        </div>
                        ${folderObj && currentView !== 'folder' ? `
                            <span class="inline-flex items-center space-x-1 text-[10px] bg-neutral-800 px-2 py-0.5 rounded-md mt-1 text-neutral-300">
                                <span class="w-2 h-2 rounded-full" style="background-color:${folderObj.color}"></span>
                                <span>${escapeHtml(folderObj.name)}</span>
                            </span>
                        ` : ''}
                    </div>
                </div>
                <div class="flex items-center space-x-1 ml-2">
                    <button onclick="event.stopPropagation(); toggleFavoriteBookFromList('${p.id}')" class="p-2 text-base ${p.isFav ? 'text-yellow-400' : 'text-neutral-500 hover:text-white'} transition" title="Favorite">${p.isFav ? '★' : '☆'}</button>
                    <button onclick="event.stopPropagation(); promptAssignFolder('${p.id}')" class="p-2 text-neutral-400 hover:text-white transition" title="Move to Folder">📁</button>
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
        list.innerHTML = `<div class="text-neutral-500 text-xs px-2 py-2">No folders created yet</div>`;
        return;
    }
    list.innerHTML = appData.folders.map(f => {
        const count = appData.pdfs.filter(p => p.folderId === f.id).length;
        const isActive = currentView === 'folder' && activeFolderId === f.id;
        return `
            <div onclick="navigateView('folder', '${f.id}'); toggleSidebar(false);" class="flex items-center justify-between px-3 py-2.5 rounded-xl ${isActive ? 'bg-neutral-800 text-white font-semibold' : 'hover:bg-neutral-800/60 text-neutral-300'} cursor-pointer transition">
                <div class="flex items-center space-x-3 truncate">
                    <span class="w-3 h-3 rounded-sm flex-shrink-0" style="background-color: ${f.color}"></span>
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
            <div class="bg-neutral-900/40 border border-neutral-800/60 rounded-3xl p-10 text-center space-y-2">
                <div class="text-3xl text-samsungBlue">❝</div>
                <p class="text-sm font-medium text-neutral-300">No saved quotes yet</p>
                <p class="text-xs text-neutral-500">Select any text while reading a PDF and tap "Save Quote" to build your collection.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = appData.quotes.map((q, idx) => `
        <div class="bg-cardBg border border-neutral-800 rounded-2xl p-4 space-y-3">
            <p class="text-sm text-neutral-100 italic leading-relaxed select-text">“${escapeHtml(q.text)}”</p>
            <div class="flex items-center justify-between text-xs text-neutral-400 pt-2 border-t border-neutral-800/80">
                <span class="text-samsungBlue font-semibold truncate max-w-[200px]">📚 ${escapeHtml(q.bookName)} • Page ${q.pageNo}</span>
                <div class="flex items-center space-x-3">
                    <button onclick="copyQuoteText(${idx})" class="text-neutral-300 hover:text-white font-medium">Copy</button>
                    <button onclick="deleteQuoteItem(${idx})" class="text-red-400 hover:underline font-medium">Delete</button>
                </div>
            </div>
        </div>
    `).join('');
}

function renderTrashList() {
    const container = document.getElementById('trashItemsContainer');
    if (appData.trash.length === 0) {
        container.innerHTML = `<div class="text-center text-neutral-500 text-xs py-10">Trash is empty</div>`;
        return;
    }
    container.innerHTML = appData.trash.map((p, idx) => `
        <div class="bg-cardBg border border-neutral-800 rounded-2xl p-3 flex items-center justify-between">
            <div class="min-w-0 flex-1">
                <h4 class="text-sm font-semibold text-neutral-300 truncate">${escapeHtml(p.title)}</h4>
                <p class="text-xs text-neutral-500">${p.pages || 1} pages</p>
            </div>
            <div class="flex items-center space-x-2">
                <button onclick="restoreFromTrash(${idx})" class="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs text-green-400 font-medium">Restore</button>
                <button onclick="deletePermanently(${idx})" class="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs text-red-400 font-medium">Delete</button>
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

// Safe High-DPI calculation so zoomed canvas stays razor-sharp without exceeding mobile GPU limits
function getSafeRetinaDPR(viewportWidth, viewportHeight) {
    const rawDpr = Math.max(window.devicePixelRatio || 1, 2.75);
    const maxCanvasDim = 4096;
    const maxAllowedDprW = maxCanvasDim / Math.max(1, viewportWidth);
    const maxAllowedDprH = maxCanvasDim / Math.max(1, viewportHeight);
    return Math.max(1, Math.min(rawDpr, maxAllowedDprW, maxAllowedDprH));
}

async function openReader(pdfId) {
    const pdfMeta = appData.pdfs.find(p => p.id === pdfId);
    if (!pdfMeta) return;

    activePdfId = pdfId;
    currentView = 'reader';
    userZoomMultiplier = 1.0;
    updateFitResetBadge();

    document.getElementById('readerBookTitle').innerText = pdfMeta.title;
    document.getElementById('readerMenuFavBtn').innerText = pdfMeta.isFav ? '★' : '☆';
    document.getElementById('readerScreen').classList.remove('hidden');

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
        currentReaderPage = pdfMeta.lastPage && pdfMeta.lastPage <= totalReaderPages ? pdfMeta.lastPage : 1;

        document.getElementById('totalPagesIndicator').innerText = totalReaderPages;
        const scrubber = document.getElementById('pageScrubberInput');
        scrubber.max = totalReaderPages;
        scrubber.value = currentReaderPage;

        if (scrollDirection === 'vertical') {
            await setupVerticalVirtualReader();
        } else {
            await renderSingleHorizontalPage(currentReaderPage);
        }
    } catch (err) {
        showToast("Could not render PDF file");
    } finally {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    }
}

function closeReader() {
    document.getElementById('readerScreen').classList.add('hidden');
    document.getElementById('quoteFloatingBtn').classList.add('hidden');
    if (verticalObserver) {
        verticalObserver.disconnect();
        verticalObserver = null;
    }
    activePdfDoc = null;
    currentView = activeFolderId ? 'folder' : 'home';
    renderWorkspace();
}

async function renderSingleHorizontalPage(pageNum) {
    if (!activePdfDoc) return;
    currentReaderPage = pageNum;
    saveLastReadPage(pageNum);

    document.getElementById('currentPageIndicator').innerText = pageNum;
    document.getElementById('pageScrubberInput').value = pageNum;
    const zoomPct = Math.round(userZoomMultiplier * 100);
    document.getElementById('readerSubStatus').innerText = `${zoomPct === 100 ? 'Ultra Clear HD • Fit to Screen' : zoomPct + '% Zoom'} • Page ${pageNum} of ${totalReaderPages}`;

    try {
        if (activeRenderTask) {
            try { activeRenderTask.cancel(); } catch (e) {}
        }

        const page = await activePdfDoc.getPage(pageNum);
        baseFitScale = computeFitToScreenScale(page, 'horizontal');
        const finalCssScale = baseFitScale * userZoomMultiplier;
        const viewport = page.getViewport({ scale: finalCssScale });

        const dpr = getSafeRetinaDPR(viewport.width, viewport.height);

        const horizArea = document.getElementById('horizontalSlideArea');
        const wrapper = document.getElementById('singlePageWrapper');
        const canvas = document.getElementById('pdfCanvas');
        const ctx = canvas.getContext('2d');

        // Ensure smooth panning when zoomed in beyond screen bounds
        if (userZoomMultiplier > 1.05) {
            horizArea.classList.remove('items-center', 'justify-center');
            horizArea.classList.add('items-start', 'justify-start');
        } else {
            horizArea.classList.remove('items-start', 'justify-start');
            horizArea.classList.add('items-center', 'justify-center');
        }

        wrapper.style.transform = 'scale(1)';
        wrapper.style.width = `${viewport.width}px`;
        wrapper.style.height = `${viewport.height}px`;

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const transformMatrix = [dpr, 0, 0, dpr, 0, 0];
        activeRenderTask = page.render({
            canvasContext: ctx,
            viewport: viewport,
            transform: transformMatrix
        });
        await activeRenderTask.promise;

        const textLayerDiv = document.getElementById('singleTextLayer');
        textLayerDiv.innerHTML = '';
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
    } catch (e) {}
}

async function setupVerticalVirtualReader() {
    if (!activePdfDoc) return;
    const vertArea = document.getElementById('verticalScrollArea');
    vertArea.innerHTML = '';
    const zoomPct = Math.round(userZoomMultiplier * 100);
    document.getElementById('readerSubStatus').innerText = `Vertical (${zoomPct === 100 ? 'Fit Width' : zoomPct + '%'}) • ${totalReaderPages} Pages`;

    if (verticalObserver) verticalObserver.disconnect();

    const firstPage = await activePdfDoc.getPage(1);
    baseFitScale = computeFitToScreenScale(firstPage, 'vertical');
    const finalCssScale = baseFitScale * userZoomMultiplier;
    const defaultVp = firstPage.getViewport({ scale: finalCssScale });

    for (let i = 1; i <= totalReaderPages; i++) {
        const pageSlot = document.createElement('div');
        pageSlot.className = `virtual-page-slot relative bg-white shadow-2xl mx-auto transition-all ${isDarkModeInverted ? 'invert-pdf' : ''}`;
        pageSlot.dataset.pageNumber = i;
        pageSlot.dataset.rendered = 'false';
        pageSlot.style.width = `${defaultVp.width}px`;
        pageSlot.style.height = `${defaultVp.height}px`;

        pageSlot.innerHTML = `
            <canvas id="vCanvas_${i}" class="block"></canvas>
            <div id="vText_${i}" class="textLayer"></div>
        `;
        vertArea.appendChild(pageSlot);
    }

    verticalObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const slot = entry.target;
                const pNum = parseInt(slot.dataset.pageNumber, 10);
                currentReaderPage = pNum;
                document.getElementById('currentPageIndicator').innerText = pNum;
                document.getElementById('pageScrubberInput').value = pNum;
                saveLastReadPage(pNum);

                if (slot.dataset.rendered === 'false') {
                    slot.dataset.rendered = 'true';
                    renderVirtualPageSlot(pNum, slot);
                }
            }
        });
    }, {
        root: vertArea,
        rootMargin: '400px 0px',
        threshold: 0.1
    });

    document.querySelectorAll('.virtual-page-slot').forEach(slot => verticalObserver.observe(slot));

    const targetSlot = vertArea.querySelector(`[data-page-number="${currentReaderPage}"]`);
    if (targetSlot) targetSlot.scrollIntoView();
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

        slotEl.style.width = `${vp.width}px`;
        slotEl.style.height = `${vp.height}px`;
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;

        const transformMatrix = [dpr, 0, 0, dpr, 0, 0];
        await page.render({
            canvasContext: canvas.getContext('2d'),
            viewport: vp,
            transform: transformMatrix
        }).promise;

        textDiv.innerHTML = '';
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

function saveLastReadPage(pageNum) {
    const p = appData.pdfs.find(x => x.id === activePdfId);
    if (p) {
        p.lastPage = pageNum;
        saveMetadata();
    }
}

function resetZoomToFit() {
    userZoomMultiplier = 1.0;
    updateFitResetBadge();
    if (scrollDirection === 'vertical') setupVerticalVirtualReader();
    else renderSingleHorizontalPage(currentReaderPage);
    showToast("Reset to Fit-to-Screen");
}

function updateFitResetBadge() {
    const btn = document.getElementById('resetFitBtn');
    if (Math.abs(userZoomMultiplier - 1.0) > 0.05) {
        btn.classList.remove('hidden');
        btn.innerText = `${Math.round(userZoomMultiplier * 100)}% • Reset Fit`;
    } else {
        btn.classList.add('hidden');
    }
}

function nextPage() {
    if (!activePdfDoc || currentReaderPage >= totalReaderPages) return;
    if (scrollDirection === 'vertical') {
        const nextSlot = document.querySelector(`.virtual-page-slot[data-page-number="${currentReaderPage + 1}"]`);
        if (nextSlot) nextSlot.scrollIntoView({ behavior: 'smooth' });
    } else {
        userZoomMultiplier = 1.0;
        updateFitResetBadge();
        renderSingleHorizontalPage(currentReaderPage + 1);
    }
}

function prevPage() {
    if (!activePdfDoc || currentReaderPage <= 1) return;
    if (scrollDirection === 'vertical') {
        const prevSlot = document.querySelector(`.virtual-page-slot[data-page-number="${currentReaderPage - 1}"]`);
        if (prevSlot) prevSlot.scrollIntoView({ behavior: 'smooth' });
    } else {
        userZoomMultiplier = 1.0;
        updateFitResetBadge();
        renderSingleHorizontalPage(currentReaderPage - 1);
    }
}

function scrubToPage(val) {
    const pageNum = parseInt(val, 10);
    if (!activePdfDoc || isNaN(pageNum)) return;
    if (scrollDirection === 'vertical') {
        const slot = document.querySelector(`.virtual-page-slot[data-page-number="${pageNum}"]`);
        if (slot) slot.scrollIntoView();
    } else {
        renderSingleHorizontalPage(pageNum);
    }
}

function jumpToPagePrompt() {
    const input = prompt(`Enter page number (1 - ${totalReaderPages}):`, currentReaderPage);
    if (!input) return;
    const num = parseInt(input, 10);
    if (num >= 1 && num <= totalReaderPages) scrubToPage(num);
    else showToast("Invalid page number");
}

function setupReaderGestures() {
    const viewer = document.getElementById('pdfViewerContainer');
    const wrapper = document.getElementById('singlePageWrapper');
    const vertArea = document.getElementById('verticalScrollArea');

    viewer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            isPinching = true;
            initialPinchDist = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            livePinchMultiplier = 1.0;
        } else if (e.touches.length === 1 && !isPinching) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }
    }, { passive: true });

    viewer.addEventListener('touchmove', (e) => {
        if (isPinching && e.touches.length === 2 && initialPinchDist) {
            e.preventDefault();
            const currentDist = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            livePinchMultiplier = currentDist / initialPinchDist;
            const clampedPreview = Math.min(3.5, Math.max(0.75, userZoomMultiplier * livePinchMultiplier)) / userZoomMultiplier;

            if (scrollDirection === 'horizontal') {
                wrapper.style.transform = `scale(${clampedPreview})`;
            } else {
                const activeSlot = vertArea.querySelector(`.virtual-page-slot[data-page-number="${currentReaderPage}"]`);
                if (activeSlot) activeSlot.style.transform = `scale(${clampedPreview})`;
            }
        }
    }, { passive: false });

    viewer.addEventListener('touchend', async (e) => {
        if (isPinching && e.touches.length < 2) {
            isPinching = false;
            if (initialPinchDist && Math.abs(livePinchMultiplier - 1.0) > 0.06) {
                userZoomMultiplier = Math.min(3.5, Math.max(1.0, userZoomMultiplier * livePinchMultiplier));
                if (userZoomMultiplier < 1.08) userZoomMultiplier = 1.0;
                wrapper.style.transform = 'scale(1)';
                updateFitResetBadge();
                if (scrollDirection === 'vertical') await setupVerticalVirtualReader();
                else await renderSingleHorizontalPage(currentReaderPage);
            } else {
                wrapper.style.transform = 'scale(1)';
                const activeSlot = vertArea.querySelector(`.virtual-page-slot[data-page-number="${currentReaderPage}"]`);
                if (activeSlot) activeSlot.style.transform = 'scale(1)';
            }
            initialPinchDist = null;
            livePinchMultiplier = 1.0;
            return;
        }

        if (e.changedTouches.length === 1) {
            const now = Date.now();
            const dx = touchStartX - e.changedTouches[0].clientX;
            const dy = Math.abs(touchStartY - e.changedTouches[0].clientY);

            if (Math.abs(dx) < 15 && dy < 15) {
                if (now - lastTapTimestamp < 280) {
                    userZoomMultiplier = userZoomMultiplier > 1.1 ? 1.0 : 2.0;
                    updateFitResetBadge();
                    if (scrollDirection === 'vertical') setupVerticalVirtualReader();
                    else renderSingleHorizontalPage(currentReaderPage);
                    lastTapTimestamp = 0;
                    return;
                }
                lastTapTimestamp = now;
            }

            if (scrollDirection === 'horizontal' && userZoomMultiplier <= 1.05) {
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
            const delta = e.deltaY < 0 ? 0.2 : -0.2;
            userZoomMultiplier = Math.min(3.5, Math.max(1.0, userZoomMultiplier + delta));
            updateFitResetBadge();
            if (scrollDirection === 'vertical') setupVerticalVirtualReader();
            else renderSingleHorizontalPage(currentReaderPage);
            return;
        }
        if (scrollDirection === 'horizontal' && userZoomMultiplier <= 1.05) {
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
        showToast(`Loaded all text from Page ${currentReaderPage}`);
    } catch (e) {
        showToast("Could not extract text from this page");
    }
}

function closeQuoteModal() { document.getElementById('quoteModal').classList.add('hidden'); }

function saveQuoteConfirmed() {
    const text = document.getElementById('quoteEditTextarea').value.trim();
    if (!text) return showToast("Please enter or select quote text");
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
    showToast("Quote saved to collection!");
}

function copyQuoteText(idx) {
    const q = appData.quotes[idx];
    if (!q) return;
    navigator.clipboard.writeText(`"${q.text}" — ${q.bookName} (Page ${q.pageNo})`);
    showToast("Quote copied to clipboard!");
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
        resultsBox.innerHTML = `<p class="text-xs text-neutral-500 text-center py-4">No matches found for "${escapeHtml(query)}"</p>`;
        return;
    }

    resultsBox.innerHTML = matches.map(m => `
        <div onclick="closeReaderSearchModal(); scrubToPage(${m.page});" class="bg-neutral-800 hover:bg-neutral-700 p-3 rounded-xl cursor-pointer transition">
            <div class="text-xs font-bold text-samsungBlue mb-1">Page ${m.page}</div>
            <p class="text-xs text-neutral-300 line-clamp-2">...${escapeHtml(m.snippet)}...</p>
        </div>
    `).join('');
}

function toggleDarkModeInvert() {
    isDarkModeInverted = !isDarkModeInverted;
    const wrapper = document.getElementById('singlePageWrapper');
    const btn = document.getElementById('darkModeToggleBtn');

    if (isDarkModeInverted) {
        wrapper.classList.add('invert-pdf');
        document.querySelectorAll('.virtual-page-slot').forEach(el => el.classList.add('invert-pdf'));
        btn.innerText = '☀️';
        showToast("AMOLED Inverted Dark Mode On");
    } else {
        wrapper.classList.remove('invert-pdf');
        document.querySelectorAll('.virtual-page-slot').forEach(el => el.classList.remove('invert-pdf'));
        btn.innerText = '🌙';
        showToast("Original Page Colors On");
    }
}

function openPageSettingsModal() {
    document.getElementById('btnScrollVert').className = `py-2.5 border rounded-xl text-sm font-medium transition ${scrollDirection === 'vertical' ? 'border-samsungBlue bg-samsungBlue/20 text-white' : 'border-neutral-700 text-neutral-400'}`;
    document.getElementById('btnScrollHoriz').className = `py-2.5 border rounded-xl text-sm font-medium transition ${scrollDirection === 'horizontal' ? 'border-samsungBlue bg-samsungBlue/20 text-white' : 'border-neutral-700 text-neutral-400'}`;
    document.getElementById('pageSettingsModal').classList.remove('hidden');
}

function closePageSettingsModal() { document.getElementById('pageSettingsModal').classList.add('hidden'); }

async function setScrollDirection(dir) {
    scrollDirection = dir;
    userZoomMultiplier = 1.0;
    updateFitResetBadge();
    const horiz = document.getElementById('horizontalSlideArea');
    const vert = document.getElementById('verticalScrollArea');

    if (dir === 'vertical') {
        horiz.classList.add('hidden');
        vert.classList.remove('hidden');
        await setupVerticalVirtualReader();
    } else {
        vert.classList.add('hidden');
        horiz.classList.remove('hidden');
        await renderSingleHorizontalPage(currentReaderPage);
    }
    closePageSettingsModal();
    showToast(`Switched to ${dir} Fit-to-Screen`);
}

function setReaderBg(color) {
    document.getElementById('pdfViewerContainer').style.backgroundColor = color;
    closePageSettingsModal();
}

function openCreateFolderModal() {
    document.getElementById('newFolderNameInput').value = '';
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
    if (!name) return showToast("Please enter a folder name");
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
            <div class="flex items-center justify-between p-3 bg-neutral-800 rounded-xl">
                <div class="flex items-center space-x-2.5 truncate">
                    <span class="w-3 h-3 rounded-full" style="background-color:${f.color}"></span>
                    <span class="text-sm font-medium text-white truncate">${escapeHtml(f.name)}</span>
                </div>
                <div class="flex items-center space-x-2">
                    <button onclick="renameFolderPrompt('${f.id}')" class="text-xs text-samsungBlue font-semibold hover:underline">Rename</button>
                    <button onclick="deleteFolderById('${f.id}')" class="text-xs text-red-400 font-semibold hover:underline">Delete</button>
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
    let html = `<div onclick="executeFolderAssignment(null)" class="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl cursor-pointer text-sm font-medium">🏠 None (Main Library)</div>`;
    html += appData.folders.map(f => `
        <div onclick="executeFolderAssignment('${f.id}')" class="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl cursor-pointer text-sm font-medium flex items-center space-x-2.5">
            <span class="w-3 h-3 rounded-full" style="background-color:${f.color}"></span>
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
    showToast("Moved selected books to Trash");
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
    document.getElementById('sortIndicatorLabel').innerHTML = `<span>${labels[order]}</span><span>⇅</span>`;
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
        showToast("Book moved to Trash");
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

function openSettingsModal() { document.getElementById('settingsModal').classList.remove('hidden'); }
function closeSettingsModal() { document.getElementById('settingsModal').classList.add('hidden'); }

function shareActiveBook() {
    const p = appData.pdfs.find(x => x.id === activePdfId);
    if (p && navigator.share) {
        navigator.share({ title: p.title, text: `Reading "${p.title}" on ReadIT` }).catch(() => {});
    } else {
        showToast("Book title copied to clipboard");
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
    appData = { folders: [], pdfs: [], quotes: [], trash: [], sortBy: 'dateDesc', viewMode: 'list', isAppInstalled: false };
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
