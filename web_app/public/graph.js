// ==========================================
// Interactive D3 Graph View Logic
// Renders the force-directed node graph and applies color groupings.
// ==========================================

class ForceGraph {
    constructor(svgId, containerId) {
        this.svg = d3.select(svgId);
        this.container = document.getElementById(containerId);
        this.g = this.svg.append("g");
        
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;
        
        this.simulation = null;
        this.nodesData = [];
        this.linksData = [];
        this.colorRules = [];
        this.activeNodeId = '';

        this.setupZoom();
        this.setupSettingsPanel(); // Initialize physics/appearance sliders
        this.loadGraphData();

        // Listen for window resize
        window.addEventListener('resize', () => this.resize());
        window.GraphSimulation = this; // Attach globally for access
    }

    // Initialize D3 Zoom behavior
    setupZoom() {
        this.zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on("zoom", (event) => {
                this.g.attr("transform", event.transform);
                
                // Add class to reveal labels when zoomed in close
                if (event.transform.k > 0.85) {
                    this.svg.classList.add("graph-zoomed-in");
                } else {
                    this.svg.classList.remove("graph-zoomed-in");
                }
            });

        this.svg.call(this.zoom);

        // Bind control buttons
        document.getElementById('zoom-in-btn').addEventListener('click', () => {
            this.svg.transition().duration(250).call(this.zoom.scaleBy, 1.3);
        });

        document.getElementById('zoom-out-btn').addEventListener('click', () => {
            this.svg.transition().duration(250).call(this.zoom.scaleBy, 0.7);
        });

        document.getElementById('zoom-fit-btn').addEventListener('click', () => {
            this.recenter();
        });
    }

    // Load graph structure and styling configs
    async loadGraphData() {
        try {
            // Load custom colors from graph.json
            const configResponse = await fetch('api/graph-config.json');
            const graphConfig = await configResponse.json();
            this.colorRules = graphConfig.colorGroups || [];

            // Load graph layout mapping (nodes, links)
            const response = await fetch('api/graph.json');
            const data = await response.json();
            
            this.nodesData = data.nodes;
            this.linksData = data.links;

            this.buildGraph();
        } catch (err) {
            console.error('Failed to load graph data:', err);
        }
    }

    // Build SVG elements and run Force Simulation
    buildGraph() {
        const width = this.width;
        const height = this.height;

        // Initialize Force Simulation
        this.simulation = d3.forceSimulation(this.nodesData)
            .force("link", d3.forceLink(this.linksData).id(d => d.id).distance(80))
            .force("charge", d3.forceManyBody().strength(-200))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide().radius(24));

        // Render Links
        this.linkElements = this.g.append("g")
            .attr("class", "links")
            .selectAll("line")
            .data(this.linksData)
            .enter().append("line")
            .attr("class", "graph-link");

        // Render Nodes Group
        this.nodeElements = this.g.append("g")
            .attr("class", "nodes")
            .selectAll("g")
            .data(this.nodesData)
            .enter().append("g")
            .attr("class", "node")
            .call(this.drag(this.simulation));

        // Draw node circles - increased sizing for visibility
        this.nodeElements.append("circle")
            .attr("class", "node-circle")
            .attr("r", d => d.id.includes('MOC') ? 14 : (d.id.includes('Lesson -') ? 10 : 7))
            .attr("fill", d => this.resolveNodeColor(d));

        // Draw node labels (rendered on hover or active state)
        this.nodeElements.append("text")
            .attr("class", "node-label")
            .attr("dx", 15)
            .attr("dy", ".35em")
            .text(d => d.name);

        // Bind simulation ticks
        this.simulation.on("tick", () => {
            this.linkElements
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);

            this.nodeElements
                .attr("transform", d => `translate(${d.x},${d.y})`);
        });

        // Click handler: Load note in editor
        this.nodeElements.on("click", (event, d) => {
            // Prevent navigating if dragging
            if (event.defaultPrevented) return;
            loadNote(d.id);
        });

        // Highlight current note if loaded
        if (AppState.currentNotePath) {
            this.highlightNode(AppState.currentNotePath);
        }
    }

    // Highlight a single node and dim others
    highlightNode(nodeId) {
        this.activeNodeId = nodeId;
        if (!this.nodeElements) return;

        this.nodeElements.classed("active", d => d.id === nodeId);
        
        // Slightly dim un-connected links
        if (this.linkElements) {
            this.linkElements.style("stroke-opacity", d => {
                if (!nodeId) return 0.5;
                return (d.source.id === nodeId || d.target.id === nodeId) ? 0.9 : 0.15;
            });
        }
    }

    // Parse queries from graph.json to resolve colors
    resolveNodeColor(node) {
        // Evaluate rules in priority order
        for (const rule of this.colorRules) {
            if (this.matchQuery(node, rule.query)) {
                return this.decimalToColor(rule.color.rgb);
            }
        }
        
        // Default gray colors
        if (node.id.includes('MOC')) return '#f59e0b';
        if (node.id.includes('Lesson -')) return '#db2777';
        return '#8c8c8c';
    }

    // Evaluate if a node matches a search query
    matchQuery(node, query) {
        // Standardize query (split by OR conditions)
        const parts = query.split(/\s+or\s+/i);
        
        for (const p of parts) {
            // Match path:"..."
            let match = p.match(/path:\s*\"([^\"]+)\"/i);
            if (match && node.id.includes(match[1])) {
                return true;
            }
            
            // Match file:"..."
            match = p.match(/file:\s*\"([^\"]+)\"/i);
            if (match && node.name.includes(match[1])) {
                return true;
            }
        }
        return false;
    }

    // Converts integer decimal color to hex
    decimalToColor(num) {
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgb(${r}, ${g}, ${b})`;
    }

    // D3 dragging handlers
    drag(simulation) {
        return d3.drag()
            .on("start", (event, d) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
            })
            .on("drag", (event, d) => {
                d.fx = event.x;
                d.fy = event.y;
            })
            .on("end", (event, d) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
            });
    }

    // Recenter and zoom to fit the graph
    recenter() {
        if (!this.nodesData || this.nodesData.length === 0) return;

        const bounds = this.g.node().getBBox();
        const fullWidth = this.svg.node().clientWidth;
        const fullHeight = this.svg.node().clientHeight;

        const width = bounds.width;
        const height = bounds.height;
        const midX = bounds.x + width / 2;
        const midY = bounds.y + height / 2;

        if (width === 0 || height === 0) return; // nothing to fit

        const scale = 0.85 / Math.max(width / fullWidth, height / fullHeight);
        const translate = [fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY];

        this.svg.transition()
            .duration(750)
            .call(this.zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
    }

    // Resize svg and center force simulation
    resize() {
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;

        if (this.simulation) {
            this.simulation.force("center", d3.forceCenter(this.width / 2, this.height / 2));
            this.simulation.alpha(0.3).restart();
        }
    }

    // Set up interactive graph physics sliders and configurations
    setupSettingsPanel() {
        const settingsBtn = document.getElementById('graph-settings-btn');
        const closeBtn = document.getElementById('close-settings-btn');
        const panel = document.getElementById('graph-settings-panel');
        
        if (settingsBtn && panel) {
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const display = panel.style.display;
                panel.style.display = display === 'none' ? 'flex' : 'none';
            });
        }
        
        if (closeBtn && panel) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                panel.style.display = 'none';
            });
        }

        // Close settings if click happens elsewhere on the graph SVG
        this.svg.on("click.settings", () => {
            if (panel) panel.style.display = 'none';
        });

        // Query input components
        const sliderRepel = document.getElementById('slider-repel');
        const sliderLink = document.getElementById('slider-link-dist');
        const sliderCollision = document.getElementById('slider-collision');
        const sliderNodeSize = document.getElementById('slider-node-size');
        const checkboxLabels = document.getElementById('checkbox-show-labels');
        const resetBtn = document.getElementById('reset-physics-btn');

        const valRepel = document.getElementById('val-repel');
        const valLink = document.getElementById('val-link-dist');
        const valCollision = document.getElementById('val-collision');
        const valNodeSize = document.getElementById('val-node-size');

        const updateSimulation = () => {
            if (!this.simulation) return;

            const repelVal = parseInt(sliderRepel.value);
            const linkVal = parseInt(sliderLink.value);
            const collisionVal = parseInt(sliderCollision.value);
            const sizeVal = parseFloat(sliderNodeSize.value);

            // Update text labels in DOM
            if (valRepel) valRepel.textContent = repelVal;
            if (valLink) valLink.textContent = linkVal;
            if (valCollision) valCollision.textContent = collisionVal;
            if (valNodeSize) valNodeSize.textContent = sizeVal.toFixed(1);

            // Update D3 simulation forces
            this.simulation.force("charge").strength(repelVal);
            this.simulation.force("link").distance(linkVal);
            this.simulation.force("collision").radius(collisionVal);

            // Update Node Circle Sizing
            if (this.nodeElements) {
                this.nodeElements.selectAll("circle")
                    .attr("r", d => (d.id.includes('MOC') ? 14 : (d.id.includes('Lesson -') ? 10 : 7)) * sizeVal);
            }

            // Labels visibility class toggle
            const showLabelsByDefault = checkboxLabels ? checkboxLabels.checked : true;
            const svgNode = document.getElementById('graph-svg');
            if (svgNode) {
                if (showLabelsByDefault) {
                    svgNode.classList.remove('hide-labels');
                } else {
                    svgNode.classList.add('hide-labels');
                }
            }

            // Heat up simulation to apply changes
            this.simulation.alpha(0.3).restart();
        };

        if (sliderRepel) sliderRepel.addEventListener('input', updateSimulation);
        if (sliderLink) sliderLink.addEventListener('input', updateSimulation);
        if (sliderCollision) sliderCollision.addEventListener('input', updateSimulation);
        if (sliderNodeSize) sliderNodeSize.addEventListener('input', updateSimulation);
        if (checkboxLabels) checkboxLabels.addEventListener('change', updateSimulation);

        if (resetBtn) {
            resetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (sliderRepel) sliderRepel.value = -200;
                if (sliderLink) sliderLink.value = 80;
                if (sliderCollision) sliderCollision.value = 24;
                if (sliderNodeSize) sliderNodeSize.value = 1.0;
                if (checkboxLabels) checkboxLabels.checked = true;
                updateSimulation();
            });
        }
    }
}

// Instantiate graph when both D3 and page load
window.addEventListener('load', () => {
    new ForceGraph('#graph-svg', 'graph-container');
});
