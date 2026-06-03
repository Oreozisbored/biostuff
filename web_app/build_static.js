const fs = require('fs');
const path = require('path');

const VAULT_ROOT = path.resolve(__dirname, '..');
const API_ROOT = path.join(__dirname, 'public', 'api');
const NOTE_API_ROOT = path.join(API_ROOT, 'note');

// List of directories/files to ignore during directory scan
const IGNORE_DIRS = new Set(['web_app', 'Sources', '.git', '.obsidian', '.antigravitycli', 'node_modules']);

console.log('Starting static build process...');
console.log(`Vault Root: ${VAULT_ROOT}`);
console.log(`API Output Directory: ${API_ROOT}`);

// Create base api and note api directories if they don't exist
fs.mkdirSync(API_ROOT, { recursive: true });
fs.mkdirSync(NOTE_API_ROOT, { recursive: true });

// Step 1: Scan vault and load all note contents in memory
const allNotes = {}; // relativePath -> { name, content, parentDir }
const notesMap = {}; // lowercaseNoteName -> relativePath

function walkDir(currentPath, relativePath = '') {
    const items = fs.readdirSync(currentPath, { withFileTypes: true });
    
    // Sort items: folders first, then files alphabetically
    items.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) {
            return a.isDirectory() ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    const dirNodes = [];

    for (const item of items) {
        if (item.name.startsWith('.') || IGNORE_DIRS.has(item.name)) {
            continue;
        }

        const itemRelPath = relativePath ? `${relativePath}/${item.name}` : item.name;
        const fullPath = path.join(currentPath, item.name);

        if (item.isDirectory()) {
            const children = walkDir(fullPath, itemRelPath);
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
            
            const content = fs.readFileSync(fullPath, 'utf8');
            const parentDir = relativePath || '.';
            
            allNotes[itemRelPath] = {
                name: noteName,
                content: content,
                parentDir: parentDir
            };

            dirNodes.push({
                name: noteName,
                type: 'file',
                path: itemRelPath
            });
        }
    }
    return dirNodes;
}

// Build file explorer tree
const fileTree = walkDir(VAULT_ROOT);
console.log(`Found ${Object.keys(allNotes).length} note files.`);

// Helper: Resolve wikilinks
function resolveWikilink(linkTarget) {
    const cleanTarget = linkTarget.trim().split('#')[0]; // Remove headers (e.g. [[Note#Section]])
    const lowerTarget = cleanTarget.toLowerCase();
    return notesMap[lowerTarget] || null;
}

// Step 2: Compute backlinks for each note
const backlinksMap = {}; // relativePath -> [ { name, path } ]
for (const relPath of Object.keys(allNotes)) {
    backlinksMap[relPath] = [];
}

const wikilinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;

for (const [sourcePath, noteData] of Object.entries(allNotes)) {
    let match;
    // Simple regex execution on file content to find links to other files
    while ((match = wikilinkRegex.exec(noteData.content)) !== null) {
        const targetName = match[1].trim();
        const targetPath = resolveWikilink(targetName);
        
        if (targetPath && targetPath !== sourcePath) {
            // sourcePath links to targetPath, so sourcePath is a backlink of targetPath
            const sourceNoteName = allNotes[sourcePath].name;
            const alreadyAdded = backlinksMap[targetPath].some(b => b.path === sourcePath);
            if (!alreadyAdded) {
                backlinksMap[targetPath].push({
                    name: sourceNoteName,
                    path: sourcePath
                });
            }
        }
    }
    // Reset regex index
    wikilinkRegex.lastIndex = 0;
}

// Step 3: Write individual note JSONs
console.log('Writing note JSON files...');
for (const [relPath, noteData] of Object.entries(allNotes)) {
    const noteJson = {
        name: noteData.name,
        path: relPath,
        content: noteData.content,
        backlinks: backlinksMap[relPath]
    };
    
    const outputFilePath = path.join(NOTE_API_ROOT, `${relPath}.json`);
    const parentDir = path.dirname(outputFilePath);
    
    // Ensure parent dir exists
    fs.mkdirSync(parentDir, { recursive: true });
    
    fs.writeFileSync(outputFilePath, JSON.stringify(noteJson, null, 2), 'utf8');
}

// Step 4: Write directory tree JSON
console.log('Writing tree.json...');
fs.writeFileSync(path.join(API_ROOT, 'tree.json'), JSON.stringify(fileTree, null, 2), 'utf8');

// Step 5: Write notes map JSON
console.log('Writing notes_map.json...');
fs.writeFileSync(path.join(API_ROOT, 'notes_map.json'), JSON.stringify(notesMap, null, 2), 'utf8');

// Step 6: Build and write graph JSON
console.log('Building graph.json...');
const nodes = [];
const links = [];
const seenLinks = new Set();

for (const [relPath, noteData] of Object.entries(allNotes)) {
    const group = noteData.parentDir === '.' ? 'root' : noteData.parentDir;
    nodes.push({
        id: relPath,
        name: noteData.name,
        group: group
    });

    let match;
    while ((match = wikilinkRegex.exec(noteData.content)) !== null) {
        const targetName = match[1].trim();
        const targetRelPath = resolveWikilink(targetName);

        if (targetRelPath && targetRelPath !== relPath) {
            const linkKey = `${relPath}->${targetRelPath}`;
            const reverseKey = `${targetRelPath}->${relPath}`;

            if (!seenLinks.has(linkKey) && !seenLinks.has(reverseKey)) {
                links.push({
                    source: relPath,
                    target: targetRelPath
                });
                seenLinks.add(linkKey);
            }
        }
    }
    wikilinkRegex.lastIndex = 0;
}
fs.writeFileSync(path.join(API_ROOT, 'graph.json'), JSON.stringify({ nodes, links }, null, 2), 'utf8');

// Step 7: Write graph-config JSON (copying from .obsidian/graph.json if exists)
console.log('Writing graph-config.json...');
const obsidianGraphConfigPath = path.join(VAULT_ROOT, '.obsidian', 'graph.json');
let graphConfig = { colorGroups: [] };
if (fs.existsSync(obsidianGraphConfigPath)) {
    try {
        const content = fs.readFileSync(obsidianGraphConfigPath, 'utf8');
        graphConfig = JSON.parse(content);
    } catch (e) {
        console.error('Failed to read .obsidian/graph.json:', e.message);
    }
}
fs.writeFileSync(path.join(API_ROOT, 'graph-config.json'), JSON.stringify(graphConfig, null, 2), 'utf8');

// Step 8: Build and write flashcards JSON
console.log('Building flashcards.json...');
const flashcards = [];
for (const [relPath, noteData] of Object.entries(allNotes)) {
    const lowerName = noteData.name.toLowerCase();
    
    // Skip MOCs and Lessons
    if (lowerName.includes('moc') || lowerName.startsWith('lesson -')) {
        continue;
    }

    // Extract definition
    let md = noteData.content;
    if (md.startsWith('---')) {
        const parts = md.split('---');
        if (parts.length >= 3) {
            md = parts.slice(2).join('---').trim();
        }
    }

    const lines = md.split('\n');
    let definition = '';

    // Check for ## Overview
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

    // Fallback to first non-empty paragraph
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

    definition = definition
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2' || '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .trim();

    if (definition) {
        flashcards.push({
            term: noteData.name,
            chapter: noteData.parentDir,
            definition: definition
        });
    }
}
fs.writeFileSync(path.join(API_ROOT, 'flashcards.json'), JSON.stringify(flashcards, null, 2), 'utf8');

// Step 9: Copy quiz data to API quiz JSON
console.log('Writing quiz.json...');
const localQuizDataPath = path.join(__dirname, 'quiz_data.json');
let quizData = {};
if (fs.existsSync(localQuizDataPath)) {
    quizData = JSON.parse(fs.readFileSync(localQuizDataPath, 'utf8'));
} else {
    console.warn('quiz_data.json not found in web_app directory!');
}
fs.writeFileSync(path.join(API_ROOT, 'quiz.json'), JSON.stringify(quizData, null, 2), 'utf8');

// Step 10: Build and write client-side search index
console.log('Building search_index.json...');
const searchIndex = [];
for (const [relPath, noteData] of Object.entries(allNotes)) {
    searchIndex.push({
        name: noteData.name,
        path: relPath,
        content: noteData.content
    });
}
fs.writeFileSync(path.join(API_ROOT, 'search_index.json'), JSON.stringify(searchIndex, null, 2), 'utf8');

console.log('Static build completed successfully!');
