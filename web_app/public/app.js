// ==========================================
// Obsidian Web Frontend Logic
// Handles file structure, navigation, searching, and note parsing.
// ==========================================

const AppState = {
    currentNotePath: '',
    currentNoteName: 'Biology MOC',
    history: [],
    historyIndex: -1
};

// DOM Elements
const elements = {
    fileTree: document.getElementById('file-tree'),
    noteTitle: document.getElementById('note-title'),
    noteBody: document.getElementById('note-body'),
    noteMetadata: document.getElementById('note-metadata'),
    noteBacklinksSection: document.getElementById('note-backlinks-section'),
    noteBacklinksList: document.getElementById('note-backlinks-list'),
    searchInput: document.getElementById('search-input'),
    searchResults: document.getElementById('search-results'),
    searchResultsPanel: document.getElementById('search-results-panel'),
    explorerPanel: document.getElementById('explorer-panel'),
    tabTitle: document.getElementById('tab-title'),
    
    // Split pane & Fullscreen elements
    workspaceBody: document.getElementById('workspace-body'),
    fullscreenGraphToggle: document.getElementById('fullscreen-graph-toggle')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    // Load notes map first so loadNote can resolve titles to paths
    try {
        const response = await fetch('api/notes_map.json');
        AppState.notesMap = await response.json();
    } catch (err) {
        console.error('Failed to load notes map:', err);
    }

    setupSearch();
    setupGraphToggle();
    setupTabSwitching(); // Initialize tabs click listeners
    loadDirectoryTree();
    
    // Bind Home button to load the start note
    const homeBtn = document.getElementById('home-btn');
    if (homeBtn) {
        homeBtn.addEventListener('click', () => {
            loadNote('Biology MOC.md');
        });
    }

    // Load initial note (Biology MOC.md)
    loadNote('Biology MOC.md');
});

// Setup full screen / split pane graph toggles
function setupGraphToggle() {
    // Start with "Show Graph" because the graph pane is collapsed by default now
    elements.fullscreenGraphToggle.innerHTML = '<i class="fa-solid fa-circle-nodes"></i> Show Graph';

    elements.fullscreenGraphToggle.addEventListener('click', () => {
        const isVisible = elements.workspaceBody.classList.toggle('graph-visible');
        elements.fullscreenGraphToggle.innerHTML = isVisible 
            ? '<i class="fa-solid fa-eye-slash"></i> Hide Graph' 
            : '<i class="fa-solid fa-circle-nodes"></i> Show Graph';
        
        // Trigger graph window resize recalculation
        if (isVisible && window.GraphSimulation) {
            setTimeout(() => {
                window.GraphSimulation.resize();
                window.GraphSimulation.recenter();
            }, 50);
        }
    });
}

// Fetch directory tree from server and render
async function loadDirectoryTree() {
    try {
        const response = await fetch('api/tree.json');
        const treeData = await response.json();
        elements.fileTree.innerHTML = '';
        renderFileTree(treeData, elements.fileTree);
        highlightActiveFile();
    } catch (err) {
        console.error('Failed to load file explorer tree:', err);
        elements.fileTree.innerHTML = '<div class="error-text">Failed to load file explorer.</div>';
    }
}

// Render folder tree elements recursively
function renderFileTree(nodes, parentEl) {
    nodes.forEach(node => {
        if (node.type === 'directory') {
            const folderDiv = document.createElement('div');
            folderDiv.className = 'tree-folder';

            const headerDiv = document.createElement('div');
            headerDiv.className = 'tree-folder-header collapsed';
            headerDiv.innerHTML = `
                <span class="tree-folder-arrow"><i class="fa-solid fa-chevron-down"></i></span>
                <span class="tree-folder-icon"><i class="fa-solid fa-folder"></i></span>
                <span class="tree-folder-name">${node.name}</span>
            `;

            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'tree-folder-children';

            // Toggle collapse/expand folders
            headerDiv.addEventListener('click', (e) => {
                headerDiv.classList.toggle('collapsed');
                // Toggle arrow rotation is handled by CSS based on collapsed class
            });

            folderDiv.appendChild(headerDiv);
            renderFileTree(node.children, childrenDiv);
            folderDiv.appendChild(childrenDiv);
            parentEl.appendChild(folderDiv);
        } else if (node.type === 'file') {
            const fileDiv = document.createElement('div');
            fileDiv.className = 'tree-file';
            fileDiv.dataset.path = node.path;
            
            // Icon customization based on file type
            let icon = '<i class="fa-regular fa-file-lines"></i>';
            if (node.name.endsWith('MOC')) {
                icon = '<i class="fa-solid fa-network-wired"></i>';
            } else if (node.name.startsWith('Lesson -')) {
                icon = '<i class="fa-solid fa-book-open"></i>';
            }

            fileDiv.innerHTML = `
                <span class="tree-file-icon">${icon}</span>
                <span class="tree-file-name">${node.name}</span>
            `;

            fileDiv.addEventListener('click', () => {
                loadNote(node.path);
            });

            parentEl.appendChild(fileDiv);
        }
    });
}

// Highlight active file inside the explorer sidebar
function highlightActiveFile() {
    document.querySelectorAll('.tree-file').forEach(el => {
        if (el.dataset.path === AppState.currentNotePath) {
            el.classList.add('active');
            
            // Expand all parents of the active file
            let parent = el.parentElement;
            while (parent && parent !== elements.fileTree) {
                if (parent.className === 'tree-folder-children') {
                    const header = parent.previousElementSibling;
                    if (header && header.classList.contains('collapsed')) {
                        header.classList.remove('collapsed');
                    }
                }
                parent = parent.parentElement;
            }
        } else {
            el.classList.remove('active');
        }
    });
}

// Load a note by relative path or name
async function loadNote(notePathOrName, pushToHistory = true) {
    // Switch to notes tab automatically so the note is visible
    switchTab('notes');

    let notePath = '';
    if (notePathOrName.endsWith('.md')) {
        notePath = notePathOrName;
    } else {
        const lowerName = notePathOrName.toLowerCase();
        notePath = AppState.notesMap ? AppState.notesMap[lowerName] : null;
        if (!notePath) {
            console.warn(`Could not resolve note name: ${notePathOrName}`);
            // Fallback: guess path
            notePath = notePathOrName + '.md';
        }
    }

    // Split by / and URI-encode each segment, then join back to preserve folder structure
    const url = 'api/note/' + notePath.split('/').map(encodeURIComponent).join('/') + '.json';

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load note: ${response.statusText}`);
        }
        
        const note = await response.json();
        
        AppState.currentNotePath = note.path;
        AppState.currentNoteName = note.name;
        
        // Update Title and UI Tabs
        elements.noteTitle.innerText = note.name;
        elements.tabTitle.innerText = note.name;
        
        // Parse and Render Markdown
        renderMarkdown(note.content);
        
        // Render Backlinks
        renderBacklinks(note.backlinks);
        
        // Update Sidebar active state
        highlightActiveFile();
        
        // Highlight in Graph
        if (window.GraphSimulation) {
            window.GraphSimulation.highlightNode(note.path);
        }

        // Handle History
        if (pushToHistory) {
            if (AppState.historyIndex < AppState.history.length - 1) {
                AppState.history = AppState.history.slice(0, AppState.historyIndex + 1);
            }
            AppState.history.push(note.path);
            AppState.historyIndex = AppState.history.length - 1;
        }
    } catch (err) {
        console.error(err);
        elements.noteBody.innerHTML = `<div class="error-text">Failed to load note contents. Ensure the file exists.</div>`;
    }
}

// Parse frontmatter yaml and markdown body
function renderMarkdown(rawContent) {
    let markdown = rawContent;
    let metadata = {};

    // 1. Extract frontmatter (enclosed between --- lines)
    if (rawContent.startsWith('---')) {
        const parts = rawContent.split('---');
        if (parts.length >= 3) {
            const yamlText = parts[1];
            markdown = parts.slice(2).join('---').trim();

            // Parse simple tag lists and single key-values from yaml
            yamlText.split('\n').forEach(line => {
                const parts = line.split(':');
                if (parts.length >= 2) {
                    const key = parts[0].trim();
                    let val = parts.slice(1).join(':').trim();
                    if (val.startsWith('[') && val.endsWith(']')) {
                        // Parse simple tag array
                        val = val.slice(1, -1).split(',').map(t => t.trim());
                    }
                    metadata[key] = val;
                }
            });
        }
    }

    // Render metadata block in UI
    if (Object.keys(metadata).length > 0) {
        elements.noteMetadata.style.display = 'block';
        elements.noteMetadata.innerHTML = '';
        
        for (const [key, val] of Object.entries(metadata)) {
            const row = document.createElement('div');
            row.className = 'metadata-row';
            
            let valHtml = '';
            if (Array.isArray(val)) {
                valHtml = val.map(t => `<span class="tag-badge">#${t}</span>`).join('');
            } else {
                valHtml = `<span class="metadata-value">${val}</span>`;
            }
            
            row.innerHTML = `
                <span class="metadata-key">${key}</span>
                <span class="metadata-value-container">${valHtml}</span>
            `;
            elements.noteMetadata.appendChild(row);
        }
    } else {
        elements.noteMetadata.style.display = 'none';
    }

    // 2. Pre-process Obsidian wikilinks and callouts before standard parsing
    
    // Parse Obsidian Callouts
    // Format: > [!Type] Title
    //         > Content
    const calloutRegex = /^>\s*\[!([a-zA-Z]+)\]\s*(.*)$/gm;
    // We can pre-process blockquotes by searching for blocks of line starting with >
    // Let's implement a simpler line-by-line parser for callouts first
    let lines = markdown.split('\n');
    let insideCallout = false;
    let calloutType = '';
    let calloutTitle = '';
    let calloutLines = [];
    let processedLines = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        
        // Start of callout check
        if (line.trim().startsWith('>') && line.includes('[!')) {
            // If we are already in one, close it
            if (insideCallout) {
                processedLines.push(formatCalloutBlock(calloutType, calloutTitle, calloutLines.join('\n')));
            }
            
            const match = line.match(/^>\s*\[!([a-zA-Z0-9_-]+)\]\s*(.*)$/);
            if (match) {
                insideCallout = true;
                calloutType = match[1].toLowerCase();
                calloutTitle = match[2].trim() || match[1];
                calloutLines = [];
                continue;
            }
        }
        
        if (insideCallout) {
            if (line.trim().startsWith('>')) {
                // Remove the leading '>' character
                let contentLine = line.replace(/^>\s?/, '');
                calloutLines.push(contentLine);
            } else {
                // Exit callout block
                insideCallout = false;
                processedLines.push(formatCalloutBlock(calloutType, calloutTitle, calloutLines.join('\n')));
                processedLines.push(line);
            }
        } else {
            processedLines.push(line);
        }
    }
    // Close trailing callout if file ends
    if (insideCallout) {
        processedLines.push(formatCalloutBlock(calloutType, calloutTitle, calloutLines.join('\n')));
    }

    markdown = processedLines.join('\n');

    // 3. Parse base markdown using Marked.js
    let html = marked.parse(markdown);

    // 4. Post-process Rendered HTML to resolve wikilinks
    // Regex matches [[Note Name]] or [[Note Name|Display Name]]
    const wikilinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
    html = html.replace(wikilinkRegex, (match, target, display) => {
        const cleanTarget = target.trim();
        const cleanDisplay = display ? display.trim() : cleanTarget;
        return `<a class="wikilink" data-target="${cleanTarget}">${cleanDisplay}</a>`;
    });

    elements.noteBody.innerHTML = html;

    // Binds click handlers to newly parsed wikilinks
    elements.noteBody.querySelectorAll('.wikilink').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const target = el.dataset.target;
            loadNote(target);
        });
    });

    // Format checkboxes in standard preview
    elements.noteBody.querySelectorAll('li').forEach(li => {
        let content = li.innerHTML;
        if (content.startsWith('[ ] ')) {
            li.innerHTML = `<input type="checkbox" disabled> ${content.substring(4)}`;
        } else if (content.startsWith('[x] ')) {
            li.innerHTML = `<input type="checkbox" checked disabled> ${content.substring(4)}`;
        }
    });
}

// Format callout tags into HTML blocks
function formatCalloutBlock(type, title, bodyMarkdown) {
    const parsedBody = marked.parse(bodyMarkdown.trim());
    
    // Choose icon based on type
    let icon = 'fa-info-circle';
    if (type === 'note') icon = 'fa-info-circle';
    else if (type === 'warning') icon = 'fa-exclamation-triangle';
    else if (type === 'caution') icon = 'fa-radiation';
    else if (type === 'tip') icon = 'fa-lightbulb';
    else if (type === 'important') icon = 'fa-exclamation-circle';

    return `
<div class="callout" data-type="${type}">
    <div class="callout-title">
        <i class="fa-solid ${icon} callout-icon"></i>
        <span>${title}</span>
    </div>
    <div class="callout-body">
        ${parsedBody}
    </div>
</div>
`;
}

// Render backlinks list at the bottom of notes
function renderBacklinks(backlinks) {
    if (backlinks && backlinks.length > 0) {
        elements.noteBacklinksSection.style.display = 'block';
        elements.noteBacklinksList.innerHTML = '';
        
        backlinks.forEach(b => {
            const badge = document.createElement('div');
            badge.className = 'backlink-badge';
            badge.innerHTML = `<i class="fa-solid fa-arrow-left"></i> ${b.name}`;
            badge.addEventListener('click', () => {
                loadNote(b.path);
            });
            elements.noteBacklinksList.appendChild(badge);
        });
    } else {
        elements.noteBacklinksSection.style.display = 'none';
    }
}

// Search execution and rendering
let searchTimeout;
let searchIndex = null;
function setupSearch() {
    elements.searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        
        const query = elements.searchInput.value.trim();
        if (!query) {
            elements.searchResults.innerHTML = '';
            // If query is empty, show the File Explorer panel and hide Search Results
            elements.explorerPanel.style.display = 'block';
            elements.searchResultsPanel.style.display = 'none';
            return;
        }

        // Debounce search requests
        searchTimeout = setTimeout(async () => {
            try {
                if (!searchIndex) {
                    const response = await fetch('api/search_index.json');
                    searchIndex = await response.json();
                }
                const results = performClientSideSearch(query);
                renderSearchResults(results);
                
                // Hide File Explorer panel and show Search Results
                elements.explorerPanel.style.display = 'none';
                elements.searchResultsPanel.style.display = 'block';
            } catch (err) {
                console.error('Search request failed:', err);
            }
        }, 150);
    });
}

function performClientSideSearch(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();

    for (const item of searchIndex) {
        const titleMatch = item.name.toLowerCase().includes(lowerQuery);
        const contentIndex = item.content.toLowerCase().indexOf(lowerQuery);

        if (titleMatch || contentIndex !== -1) {
            // Generate a small preview snippet if it matched in content
            let snippet = '';
            if (contentIndex !== -1) {
                const start = Math.max(0, contentIndex - 30);
                const end = Math.min(item.content.length, contentIndex + query.length + 50);
                snippet = '...' + item.content.substring(start, end).replace(/\r?\n/g, ' ') + '...';
            } else {
                snippet = item.content.substring(0, 80).replace(/\r?\n/g, ' ') + '...';
            }

            results.push({
                name: item.name,
                path: item.path,
                titleMatch: titleMatch,
                snippet: snippet
            });
        }
    }
    return results;
}

function renderSearchResults(results) {
    elements.searchResults.innerHTML = '';
    
    if (results.length === 0) {
        elements.searchResults.innerHTML = '<div class="no-results">No notes matched your query.</div>';
        return;
    }

    results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        
        item.innerHTML = `
            <div class="search-result-title">${result.name}</div>
            <div class="search-result-snippet">${escapeHtml(result.snippet)}</div>
        `;
        
        item.addEventListener('click', () => {
            loadNote(result.path);
        });
        
        elements.searchResults.appendChild(item);
    });
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// ==========================================
// Tab Navigation Switcher
// ==========================================
function setupTabSwitching() {
    const notesBtn = document.getElementById('tab-notes-btn');
    const flashcardsBtn = document.getElementById('tab-flashcards-btn');
    const quizzesBtn = document.getElementById('tab-quizzes-btn');
    
    notesBtn.addEventListener('click', () => switchTab('notes'));
    flashcardsBtn.addEventListener('click', () => switchTab('flashcards'));
    quizzesBtn.addEventListener('click', () => switchTab('quizzes'));
}

function switchTab(tabName) {
    // Remove active class from all tabs
    document.querySelectorAll('#tab-bar .tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Add active class to clicked tab
    if (tabName === 'notes') {
        document.getElementById('tab-notes-btn').classList.add('active');
        elements.workspaceBody.className = 'notes-active';
        elements.fullscreenGraphToggle.style.display = 'flex';
        // If graph is toggled, resize it
        if (elements.workspaceBody.classList.contains('graph-visible') && window.GraphSimulation) {
            setTimeout(() => {
                window.GraphSimulation.resize();
            }, 50);
        }
    } else if (tabName === 'flashcards') {
        document.getElementById('tab-flashcards-btn').classList.add('active');
        elements.workspaceBody.className = 'flashcards-active';
        elements.fullscreenGraphToggle.style.display = 'none';
        initFlashcards();
    } else if (tabName === 'quizzes') {
        document.getElementById('tab-quizzes-btn').classList.add('active');
        elements.workspaceBody.className = 'quizzes-active';
        elements.fullscreenGraphToggle.style.display = 'none';
        initQuizzes();
    }
}

// ==========================================
// Flashcards Engine (Anki Style)
// ==========================================
let allFlashcards = [];
let activeFlashcards = [];
let currentCardIndex = 0;
let flashcardsInitialized = false;

async function initFlashcards() {
    if (flashcardsInitialized) return;
    flashcardsInitialized = true;
    
    try {
        const response = await fetch('api/flashcards.json');
        allFlashcards = await response.json();
        
        // Populate chapter dropdown
        const select = document.getElementById('flashcard-chapter-select');
        select.innerHTML = '<option value="all">-- All Chapters --</option>';
        
        // Extract unique chapters and sort them
        const chapters = [...new Set(allFlashcards.map(fc => fc.chapter))].sort();
        chapters.forEach(ch => {
            const opt = document.createElement('option');
            opt.value = ch;
            opt.textContent = ch;
            select.appendChild(opt);
        });
        
        // Restore last selected chapter from localStorage
        const savedChapter = localStorage.getItem('bio_flashcard_chapter') || 'all';
        select.value = savedChapter;
        
        // Add dropdown change listener
        select.addEventListener('change', () => {
            localStorage.setItem('bio_flashcard_chapter', select.value);
            loadFlashcardDeck(select.value);
        });

        // Reset progress button listener
        const resetProgressBtn = document.getElementById('fc-reset-mastered-btn');
        if (resetProgressBtn) {
            resetProgressBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to reset your flashcard progress? This will clear all mastered terms.')) {
                    localStorage.removeItem('bio_mastered_terms');
                    updateMasteredStats();
                    // Reload current deck to update visual checkmarks
                    loadFlashcardDeck(select.value);
                }
            });
        }
        
        // Card click triggers flip
        const card = document.getElementById('flashcard-card');
        card.addEventListener('click', () => {
            if (!card.classList.contains('flipped')) {
                revealFlashcardAnswer();
            }
        });
        
        // "Show Answer" button
        document.getElementById('fc-show-btn').addEventListener('click', revealFlashcardAnswer);
        
        // Feedback buttons
        document.getElementById('fc-btn-again').addEventListener('click', () => handleFlashcardFeedback('again'));
        document.getElementById('fc-btn-good').addEventListener('click', () => handleFlashcardFeedback('good'));
        document.getElementById('fc-btn-easy').addEventListener('click', () => handleFlashcardFeedback('easy'));
        
        // Load initial deck
        loadFlashcardDeck(select.value);
        
    } catch (err) {
        console.error('Failed to initialize flashcards:', err);
    }
}

function loadFlashcardDeck(chapterFilter) {
    if (chapterFilter === 'all') {
        activeFlashcards = [...allFlashcards];
    } else {
        activeFlashcards = allFlashcards.filter(fc => fc.chapter === chapterFilter);
    }
    
    // Shuffle deck
    shuffleArray(activeFlashcards);
    
    currentCardIndex = 0;
    showFlashcard(currentCardIndex);
    updateMasteredStats();
}

function showFlashcard(index) {
    const card = document.getElementById('flashcard-card');
    card.classList.remove('flipped');
    
    const showBtn = document.getElementById('fc-show-btn');
    const feedbackGroup = document.getElementById('fc-feedback-btns');
    showBtn.style.display = 'block';
    feedbackGroup.style.display = 'none';
    
    // Clean up restart button if it exists
    const restartBtn = document.getElementById('fc-restart-btn');
    if (restartBtn) restartBtn.remove();
    
    const progressText = document.getElementById('fc-progress-text');
    
    if (!activeFlashcards || activeFlashcards.length === 0) {
        document.getElementById('fc-term').textContent = 'No Terms Found';
        document.getElementById('fc-definition').textContent = 'There are no terms in this chapter.';
        document.getElementById('fc-meta-front').textContent = '';
        document.getElementById('fc-meta-back').textContent = '';
        progressText.textContent = 'Card 0 of 0';
        showBtn.style.display = 'none';
        return;
    }
    
    const fc = activeFlashcards[index];
    
    // Read mastered list from localStorage and add double checkmark icon if term is mastered
    const mastered = JSON.parse(localStorage.getItem('bio_mastered_terms') || '[]');
    const isMastered = mastered.includes(fc.term);
    
    if (isMastered) {
        document.getElementById('fc-term').innerHTML = `${fc.term} <i class="fa-solid fa-check-double" style="color:var(--accent-hover); font-size:1.3rem; margin-left: 6px;" title="Mastered"></i>`;
    } else {
        document.getElementById('fc-term').textContent = fc.term;
    }
    
    document.getElementById('fc-definition').textContent = fc.definition;
    
    const chapterName = fc.chapter || 'Root';
    document.getElementById('fc-meta-front').textContent = chapterName;
    document.getElementById('fc-meta-back').textContent = chapterName;
    
    progressText.textContent = `Card ${index + 1} of ${activeFlashcards.length}`;
}

function revealFlashcardAnswer() {
    const card = document.getElementById('flashcard-card');
    card.classList.add('flipped');
    
    document.getElementById('fc-show-btn').style.display = 'none';
    document.getElementById('fc-feedback-btns').style.display = 'flex';
}

function handleFlashcardFeedback(quality) {
    const currentCard = activeFlashcards[currentCardIndex];
    let mastered = JSON.parse(localStorage.getItem('bio_mastered_terms') || '[]');

    if (quality === 'again') {
        // Remove from mastered list if marked "Again"
        mastered = mastered.filter(t => t !== currentCard.term);
        localStorage.setItem('bio_mastered_terms', JSON.stringify(mastered));

        // Spaced repetition behavior: insert the current card back into the deck 3 cards later (or at the end if the deck is small)
        // Remove card from current position
        activeFlashcards.splice(currentCardIndex, 1);
        
        // Calculate insert index: current Index + 3 or end of list
        const insertIndex = Math.min(activeFlashcards.length, currentCardIndex + 3);
        activeFlashcards.splice(insertIndex, 0, currentCard);
        
        // If we inserted it after the current index, our currentCardIndex is still valid.
        if (currentCardIndex >= activeFlashcards.length) {
            currentCardIndex = 0; // wrap around
        }
    } else {
        // 'good' or 'easy': mark as mastered and advance
        if (!mastered.includes(currentCard.term)) {
            mastered.push(currentCard.term);
            localStorage.setItem('bio_mastered_terms', JSON.stringify(mastered));
        }
        currentCardIndex++;
    }
    
    updateMasteredStats();

    // Check if we finished the deck
    if (currentCardIndex >= activeFlashcards.length) {
        alertDeckCompletion();
    } else {
        showFlashcard(currentCardIndex);
    }
}

// Calculate and render mastered terminology statistics
function updateMasteredStats() {
    const countSpan = document.getElementById('fc-mastered-count');
    if (!countSpan) return;

    const mastered = JSON.parse(localStorage.getItem('bio_mastered_terms') || '[]');
    const total = activeFlashcards.length;
    const masteredCount = activeFlashcards.filter(fc => mastered.includes(fc.term)).length;

    countSpan.innerHTML = `<i class="fa-solid fa-check-double"></i> Mastered in Deck: <strong>${masteredCount} / ${total}</strong> terms`;
}

function alertDeckCompletion() {
    const card = document.getElementById('flashcard-card');
    card.classList.remove('flipped');
    
    document.getElementById('fc-term').textContent = 'Study Session Complete!';
    document.getElementById('fc-definition').textContent = 'You have reviewed all the terms in this deck. Great job!';
    document.getElementById('fc-meta-front').textContent = '';
    document.getElementById('fc-meta-back').textContent = '';
    
    document.getElementById('fc-show-btn').style.display = 'none';
    document.getElementById('fc-feedback-btns').style.display = 'none';
    
    const progressText = document.getElementById('fc-progress-text');
    progressText.textContent = 'All Cards Completed';
    
    // Add a restart button in place of the normal buttons
    const controls = document.querySelector('.flashcard-controls');
    let restartBtn = document.getElementById('fc-restart-btn');
    if (!restartBtn) {
        restartBtn = document.createElement('button');
        restartBtn.id = 'fc-restart-btn';
        restartBtn.className = 'study-btn primary-btn';
        restartBtn.textContent = 'Start Again';
        restartBtn.addEventListener('click', () => {
            restartBtn.remove();
            loadFlashcardDeck(document.getElementById('flashcard-chapter-select').value);
        });
        controls.appendChild(restartBtn);
    }
}

// Utility: Shuffle
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// ==========================================
// Practice Quizzes Engine
// ==========================================
let quizzesData = null;
let currentQuizName = '';
let currentQuizQuestions = [];
let currentQuestionIndex = 0;
let quizScore = 0;
let optionSelected = false;
let quizzesInitialized = false;

async function initQuizzes() {
    if (quizzesInitialized) return;
    quizzesInitialized = true;
    
    // Exit quiz button
    document.getElementById('quiz-back-btn').addEventListener('click', () => {
        if (confirm('Are you sure you want to exit this practice test? Your progress will be lost.')) {
            showQuizSelectionScreen();
        }
    });

    // Next question button
    document.getElementById('quiz-next-btn').addEventListener('click', handleQuizNextQuestion);

    // Results screen buttons
    document.getElementById('quiz-restart-btn').addEventListener('click', () => {
        startQuiz(currentQuizName);
    });
    document.getElementById('quiz-return-btn').addEventListener('click', showQuizSelectionScreen);

    try {
        const response = await fetch('api/quiz.json');
        quizzesData = await response.json();
        
        renderQuizSelection();
    } catch (err) {
        console.error('Failed to load quiz data:', err);
    }
}

function renderQuizSelection() {
    const grid = document.getElementById('quiz-list-grid');
    grid.innerHTML = '';
    
    const scores = JSON.parse(localStorage.getItem('bio_quiz_scores') || '{}');

    // quizzesData should contain Test 1, Test 2, ... Test 10
    Object.keys(quizzesData).forEach(testName => {
        const questionsList = quizzesData[testName];
        const savedScore = scores[testName];
        
        const scoreHtml = savedScore !== undefined 
            ? `<div class="high-score"><i class="fa-solid fa-trophy"></i> High Score: <strong>${savedScore} / ${questionsList.length}</strong> (${Math.round(savedScore/questionsList.length*100)}%)</div>` 
            : '<div class="high-score" style="color:var(--text-muted); background:none; border-color:var(--border-color);"><i class="fa-regular fa-star"></i> No previous attempts</div>';

        const card = document.createElement('div');
        card.className = 'quiz-card';
        card.innerHTML = `
            <h3>${testName}</h3>
            <p>Topics: Comprehensive biology practice exam testing cellular life, chemistry, genetics, and ecology.</p>
            ${scoreHtml}
            <p><strong>${questionsList.length} Questions</strong> • Multiple Choice</p>
            <div class="quiz-card-btn">Start Test</div>
        `;
        
        card.addEventListener('click', () => {
            startQuiz(testName);
        });
        
        grid.appendChild(card);
    });
}

function showQuizSelectionScreen() {
    document.getElementById('quiz-selection-screen').style.display = 'block';
    document.getElementById('quiz-arena-screen').style.display = 'none';
    document.getElementById('quiz-results-screen').style.display = 'none';
}

function startQuiz(testName) {
    currentQuizName = testName;
    currentQuizQuestions = quizzesData[testName];
    currentQuestionIndex = 0;
    quizScore = 0;
    
    document.getElementById('quiz-selection-screen').style.display = 'none';
    document.getElementById('quiz-arena-screen').style.display = 'block';
    document.getElementById('quiz-results-screen').style.display = 'none';
    
    // Update HUD
    document.getElementById('quiz-title-hud').textContent = testName;
    
    showQuizQuestion(currentQuestionIndex);
}

function showQuizQuestion(index) {
    optionSelected = false;
    const question = currentQuizQuestions[index];
    
    // HUD
    document.getElementById('quiz-score-hud').textContent = `Score: ${quizScore} / ${index}`;
    
    // Question headers
    document.getElementById('q-number').textContent = `Question ${index + 1} of ${currentQuizQuestions.length}`;
    document.getElementById('q-text').textContent = question.question;
    
    // Next Button state
    const nextBtn = document.getElementById('quiz-next-btn');
    nextBtn.disabled = true;
    nextBtn.textContent = (index === currentQuizQuestions.length - 1) ? 'Finish Test' : 'Next Question';
    
    // Hide explanation box
    const expBox = document.getElementById('q-explanation');
    expBox.style.display = 'none';
    
    // Populate options
    const optionsContainer = document.getElementById('q-options');
    optionsContainer.innerHTML = '';
    
    const alphabet = ['A', 'B', 'C', 'D'];
    question.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.innerHTML = `
            <span class="option-prefix">${alphabet[idx]}</span>
            <span class="option-label">${escapeHtml(opt)}</span>
        `;
        
        btn.addEventListener('click', () => {
            if (optionSelected) return;
            selectQuizOption(idx, btn);
        });
        
        optionsContainer.appendChild(btn);
    });
}

function selectQuizOption(selectedIdx, btnElement) {
    optionSelected = true;
    const question = currentQuizQuestions[currentQuestionIndex];
    const correctIdx = question.correct;
    
    const optionsContainer = document.getElementById('q-options');
    const optionBtns = optionsContainer.querySelectorAll('.option-btn');
    
    // Disable all options
    optionBtns.forEach(btn => btn.disabled = true);
    
    const isCorrect = (selectedIdx === correctIdx);
    if (isCorrect) {
        quizScore++;
        btnElement.classList.add('correct');
    } else {
        btnElement.classList.add('incorrect');
        // Also highlight correct answer in green
        optionBtns[correctIdx].classList.add('correct');
    }
    
    // Update Score HUD
    document.getElementById('quiz-score-hud').textContent = `Score: ${quizScore} / ${currentQuestionIndex + 1}`;
    
    // Display explanation box
    const expBox = document.getElementById('q-explanation');
    const expTitle = document.getElementById('q-explanation-title');
    const expText = document.getElementById('q-explanation-text');
    
    expBox.style.display = 'block';
    if (isCorrect) {
        expBox.className = 'explanation-box correct-feedback';
        expTitle.innerHTML = '<i class="fa-solid fa-circle-check"></i> Correct!';
    } else {
        expBox.className = 'explanation-box incorrect-feedback';
        expTitle.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Incorrect';
    }
    
    expText.textContent = question.explanation;
    
    // Enable Next button
    document.getElementById('quiz-next-btn').disabled = false;
}

function handleQuizNextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex < currentQuizQuestions.length) {
        showQuizQuestion(currentQuestionIndex);
    } else {
        showQuizResults();
    }
}

function showQuizResults() {
    document.getElementById('quiz-selection-screen').style.display = 'none';
    document.getElementById('quiz-arena-screen').style.display = 'none';
    document.getElementById('quiz-results-screen').style.display = 'block';
    
    const totalQuestions = currentQuizQuestions.length;
    const percentage = Math.round((quizScore / totalQuestions) * 100);
    
    // Save high score to localStorage
    const scores = JSON.parse(localStorage.getItem('bio_quiz_scores') || '{}');
    const prevScore = scores[currentQuizName] || 0;
    if (quizScore > prevScore) {
        scores[currentQuizName] = quizScore;
        localStorage.setItem('bio_quiz_scores', JSON.stringify(scores));
    }

    document.getElementById('quiz-final-score').textContent = `${quizScore} / ${totalQuestions}`;
    document.getElementById('quiz-final-percent').textContent = `${percentage}%`;
    
    let evaluation = '';
    if (percentage >= 90) {
        evaluation = 'Outstanding! You have a stellar understanding of the biology concepts covered in this exam. Ready for the final!';
    } else if (percentage >= 80) {
        evaluation = 'Great job! You have a very solid foundation in these topics. Review the few questions you missed to lock in a perfect score.';
    } else if (percentage >= 70) {
        evaluation = 'Good effort. Go back and study the specific chapters corresponding to the questions you missed before retrying.';
    } else {
        evaluation = 'Keep practicing. Biology requires active recall and deep understanding. Study the terms and lessons, then try this test again!';
    }
    
    document.getElementById('quiz-final-eval').textContent = evaluation;
}
