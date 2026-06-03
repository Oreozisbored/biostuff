const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const VAULT_ROOT = path.resolve(__dirname, '..');

// Middleware to serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// List of directories/files to ignore during directory scan
const IGNORE_DIRS = new Set(['web_app', 'Sources', '.git', '.obsidian', '.antigravitycli', 'node_modules']);

// Helper: Scan vault and build file tree + map of note names to relative paths
function scanVault() {
    const fileTree = [];
    const notesMap = {}; // Lowercase note title -> relative path

    function walkDir(currentPath, relativePath = '') {
        const items = fs.readdirSync(currentPath, { withFileTypes: true });
        const dirNodes = [];

        // Sort items: folders first, then files alphabetically
        items.sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) {
                return a.isDirectory() ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        for (const item of items) {
            if (item.name.startsWith('.') || IGNORE_DIRS.has(item.name)) {
                continue;
            }

            const itemRelPath = relativePath ? `${relativePath}/${item.name}` : item.name;
            const fullPath = path.join(currentPath, item.name);

            if (item.isDirectory()) {
                const children = walkDir(fullPath, itemRelPath);
                // Only add directory if it contains markdown files or subdirectories
                if (children.length > 0) {
                    dirNodes.push({
                        name: item.name,
                        type: 'directory',
                        path: itemRelPath,
                        children: children
                    });
                }
            } else if (item.isFile() && item.name.endsWith('.md')) {
                const noteName = item.name.slice(0, -3); // Remove .md
                notesMap[noteName.toLowerCase()] = itemRelPath;
                dirNodes.push({
                    name: noteName,
                    type: 'file',
                    path: itemRelPath
                });
            }
        }
        return dirNodes;
    }

    const tree = walkDir(VAULT_ROOT);
    return { tree, notesMap };
}

// Helper: Resolve a wikilink to its relative path
function resolveWikilink(linkTarget, notesMap) {
    const cleanTarget = linkTarget.trim().split('#')[0]; // Remove headers (e.g. [[Note#Section]])
    const lowerTarget = cleanTarget.toLowerCase();
    
    // Exact match in map
    if (notesMap[lowerTarget]) {
        return notesMap[lowerTarget];
    }
    
    // Check if it's named with MOC or Lesson and might resolve
    return null;
}

// Endpoint: File Explorer Tree
app.get('/api/tree', (req, res) => {
    try {
        const { tree } = scanVault();
        res.json(tree);
    } catch (err) {
        res.status(500).json({ error: 'Failed to scan vault directory', details: err.message });
    }
});

// Endpoint: Read Note Contents and Metadata
app.get('/api/note', (req, res) => {
    let notePath = req.query.path;
    const noteNameQuery = req.query.name;
    
    // Resolve note name to relative path if only name is provided
    if (!notePath && noteNameQuery) {
        const { notesMap } = scanVault();
        notePath = notesMap[noteNameQuery.toLowerCase()];
    }

    if (!notePath || notePath.includes('..')) {
        return res.status(400).json({ error: 'Invalid file path or note name' });
    }

    const fullPath = path.join(VAULT_ROOT, notePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        return res.status(404).json({ error: 'Note not found' });
    }

    try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const noteName = path.basename(notePath, '.md');
        
        // Find backlinks
        const { notesMap } = scanVault();
        const backlinks = [];
        
        // Walk all files and search for links to this note
        function findLinks(currentPath, relPath = '') {
            const items = fs.readdirSync(currentPath, { withFileTypes: true });
            for (const item of items) {
                if (item.name.startsWith('.') || IGNORE_DIRS.has(item.name)) {
                    continue;
                }
                const itemRelPath = relPath ? `${relPath}/${item.name}` : item.name;
                const fullItemPath = path.join(currentPath, item.name);
                
                if (item.isDirectory()) {
                    findLinks(fullItemPath, itemRelPath);
                } else if (item.isFile() && item.name.endsWith('.md') && itemRelPath !== notePath) {
                    const fileContent = fs.readFileSync(fullItemPath, 'utf8');
                    // Check if file content contains [[noteName]] or [[noteName|...]]
                    const escapedName = noteName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    const linkRegex = new RegExp(`\\[\\[${escapedName}(\\|[^\\]]+)?\\]\\]`, 'i');
                    
                    if (linkRegex.test(fileContent)) {
                        backlinks.push({
                            name: item.name.slice(0, -3),
                            path: itemRelPath
                        });
                    }
                }
            }
        }
        findLinks(VAULT_ROOT);

        res.json({
            name: noteName,
            path: notePath,
            content: content,
            backlinks: backlinks
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to read note content', details: err.message });
    }
});

// Endpoint: Search notes
app.get('/api/search', (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.json([]);
    }

    const { notesMap } = scanVault();
    const results = [];
    const lowerQuery = query.toLowerCase();

    try {
        for (const [noteName, relPath] of Object.entries(notesMap)) {
            const fullPath = path.join(VAULT_ROOT, relPath);
            const content = fs.readFileSync(fullPath, 'utf8');
            const noteTitle = path.basename(relPath, '.md');
            
            const titleMatch = noteTitle.toLowerCase().includes(lowerQuery);
            const contentIndex = content.toLowerCase().indexOf(lowerQuery);
            
            if (titleMatch || contentIndex !== -1) {
                // Generate a small preview snippet if it matched in content
                let snippet = '';
                if (contentIndex !== -1) {
                    const start = Math.max(0, contentIndex - 30);
                    const end = Math.min(content.length, contentIndex + query.length + 50);
                    snippet = '...' + content.substring(start, end).replace(/\r?\n/g, ' ') + '...';
                } else {
                    snippet = content.substring(0, 80).replace(/\r?\n/g, ' ') + '...';
                }

                results.push({
                    name: noteTitle,
                    path: relPath,
                    titleMatch: titleMatch,
                    snippet: snippet
                });
            }
        }
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: 'Search failed', details: err.message });
    }
});

// Endpoint: Graph Data (Nodes and Links)
app.get('/api/graph', (req, res) => {
    try {
        const { notesMap } = scanVault();
        const nodes = [];
        const links = [];
        const seenLinks = new Set();

        const linkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;

        // Build nodes list
        for (const [noteLower, relPath] of Object.entries(notesMap)) {
            const noteName = path.basename(relPath, '.md');
            const parentDir = path.dirname(relPath);
            const group = parentDir === '.' ? 'root' : parentDir;
            
            nodes.push({
                id: relPath,
                name: noteName,
                group: group
            });

            // Parse links from this note
            const fullPath = path.join(VAULT_ROOT, relPath);
            const content = fs.readFileSync(fullPath, 'utf8');
            
            let match;
            while ((match = linkRegex.exec(content)) !== null) {
                const targetName = match[1].trim();
                const targetRelPath = resolveWikilink(targetName, notesMap);
                
                if (targetRelPath && targetRelPath !== relPath) {
                    const linkKey = `${relPath}->${targetRelPath}`;
                    const reverseKey = `${targetRelPath}->${relPath}`;
                    
                    // Avoid duplicate or bi-directional duplicates in visualization
                    if (!seenLinks.has(linkKey) && !seenLinks.has(reverseKey)) {
                        links.push({
                            source: relPath,
                            target: targetRelPath
                        });
                        seenLinks.add(linkKey);
                    }
                }
            }
        }

        res.json({ nodes, links });
    } catch (err) {
        res.status(500).json({ error: 'Failed to build graph data', details: err.message });
    }
});

// Endpoint: Obsidian graph config
app.get('/api/graph-config', (req, res) => {
    const configPath = path.join(VAULT_ROOT, '.obsidian', 'graph.json');
    if (fs.existsSync(configPath)) {
        try {
            const config = fs.readFileSync(configPath, 'utf8');
            res.json(JSON.parse(config));
        } catch (err) {
            res.status(500).json({ error: 'Failed to read graph.json', details: err.message });
        }
    } else {
        res.json({ colorGroups: [] });
    }
});

// Endpoint: Flashcards (extracts definitions dynamically from term note files)
app.get('/api/flashcards', (req, res) => {
    try {
        const { notesMap } = scanVault();
        const flashcards = [];

        for (const [noteLower, relPath] of Object.entries(notesMap)) {
            // Skip MOCs and Lessons
            if (noteLower.includes('moc') || noteLower.startsWith('lesson -')) {
                continue;
            }

            const fullPath = path.join(VAULT_ROOT, relPath);
            const content = fs.readFileSync(fullPath, 'utf8');
            const noteName = path.basename(relPath, '.md');
            const parentDir = path.dirname(relPath);
            
            // Extract definition from file content
            let md = content;
            if (content.startsWith('---')) {
                const parts = content.split('---');
                if (parts.length >= 3) {
                    md = parts.slice(2).join('---').trim();
                }
            }

            const lines = md.split('\n');
            let definition = '';
            
            // 1. Check for ## Overview
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim().toLowerCase().startsWith('## overview')) {
                    let j = i + 1;
                    while (j < lines.length && !lines[j].trim().startsWith('#')) {
                        if (lines[j].trim()) {
                            definition += lines[j].trim() + ' ';
                        }
                        j++;
                    }
                    break;
                }
            }

            // 2. Fallback to first non-empty paragraph that isn't a heading
            if (!definition) {
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('*')) {
                        let j = i;
                        while (j < lines.length && lines[j].trim() && !lines[j].trim().startsWith('#')) {
                            definition += lines[j].trim() + ' ';
                            j++;
                        }
                        break;
                    }
                }
            }

            // Clean up Markdown links and styling from the definition
            definition = definition
                .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2' || '$1') // remove wikilinks
                .replace(/\*\*([^*]+)\*\*/g, '$1') // remove bold
                .replace(/\*([^*]+)\*/g, '$1') // remove italics
                .trim();

            if (definition) {
                flashcards.push({
                    term: noteName,
                    chapter: parentDir,
                    definition: definition
                });
            }
        }

        res.json(flashcards);
    } catch (err) {
        res.status(500).json({ error: 'Failed to build flashcards data', details: err.message });
    }
});

// Endpoint: Practice Quizzes
app.get('/api/quiz', (req, res) => {
    const quizPath = path.join(__dirname, 'quiz_data.json');
    if (fs.existsSync(quizPath)) {
        try {
            const data = fs.readFileSync(quizPath, 'utf8');
            res.json(JSON.parse(data));
        } catch (err) {
            res.status(500).json({ error: 'Failed to read quiz_data.json', details: err.message });
        }
    } else {
        res.status(404).json({ error: 'Quiz data not found' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Obsidian Web Server running on port ${PORT}`);
    console.log(`📂 Serving Vault: ${VAULT_ROOT}`);
    console.log(`🌐 Frontend Address: http://localhost:${PORT}`);
    console.log(`====================================================`);
});
