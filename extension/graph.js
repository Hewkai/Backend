// ตัวแปรสำหรับเก็บข้อมูลและอ้างอิง Network
let rawNodes = [];
let rawEdges = [];
let network = null;

document.addEventListener('DOMContentLoaded', () => {
    loadGraph();
    document.getElementById('refreshBtn').addEventListener('click', loadGraph);

    // เพิ่ม Event Listener ให้ Checkbox สำหรับการกรองข้อมูล
    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('filter-check')) {
            applyFilterAndRender();
        }
    });
});

/**
 * ฟังก์ชันดึง User ID จาก Storage 
 */
async function getUserId() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['cookies_user_id'], (result) => {
            if (result.cookies_user_id) {
                resolve(result.cookies_user_id);
            } else {
                const newId = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
                chrome.storage.local.set({ cookies_user_id: newId }, () => {
                    console.log("[CookiesChecker] ID Generated in Graph:", newId);
                    resolve(newId);
                });
            }
        });
    });
}

/**
 * ฟังก์ชันตรวจสอบว่าเป็น Tracking หรือไม่ (เกณฑ์ตัดสินกลาง)
 * ใช้ทั้งการคำนวณสถิติ การระบายสีเส้น และการกรองข้อมูล
 */
function isTracking(type, domain = "") {
    const t = (type || '').toUpperCase();
    const d = (domain || '').toUpperCase();
    return t.includes('TARGETING') || t.includes('ADVERTISING') || 
           t.includes('TRACKING') || t.includes('ADS') || 
           t.includes('MARKETING') || d.includes('DOUBLECLICK') || 
           d.includes('PUBMATIC') || d.includes('GOOGLEADSERVICES');
}

/**
 * คำนวณเปอร์เซ็นต์ของคุกกี้แต่ละประเภทและแสดงผลบนหน้าจอ
 */
function calculateStats(edges) {
    const counts = { necessary: 0, performance: 0, functionality: 0, tracking: 0, unknown: 0 };
    
    if (edges && edges.length > 0) {
        edges.forEach(edge => {
            const label = edge.label || '';
            const targetNode = rawNodes.find(n => n.id === edge.to);
            const domainName = targetNode ? targetNode.label : "";

            if (isTracking(label, domainName)) {
                counts.tracking++;
            } 
            else if (label.toUpperCase().includes('NECESSARY') || label.toUpperCase().includes('STRICTLY')) {
                counts.necessary++;
            } 
            else if (label.toUpperCase().includes('PERFORMANCE') || label.toUpperCase().includes('ANALYTICS') || label.toUpperCase().includes('STAT')) {
                counts.performance++;
            } 
            else if (label.toUpperCase().includes('FUNCTIONALITY')) {
                counts.functionality++;
            } 
            else {
                counts.unknown++;
            }
        });

        const total = edges.length;
        const toPct = (val) => ((val / total) * 100).toFixed(1) + '%';

        document.getElementById('pct-necessary').innerText = toPct(counts.necessary);
        document.getElementById('pct-performance').innerText = toPct(counts.performance);
        document.getElementById('pct-functionality').innerText = toPct(counts.functionality);
        document.getElementById('pct-tracking').innerText = toPct(counts.tracking);
        document.getElementById('pct-unknown').innerText = toPct(counts.unknown);
    } else {
        const resetValue = "0%";
        document.getElementById('pct-necessary').innerText = resetValue;
        document.getElementById('pct-performance').innerText = resetValue;
        document.getElementById('pct-functionality').innerText = resetValue;
        document.getElementById('pct-tracking').innerText = resetValue;
        document.getElementById('pct-unknown').innerText = resetValue;
    }
}

/**
 * ดึงข้อมูลกราฟจาก API
 */
async function loadGraph() {
    try {
        const userId = await getUserId();
        const urlParams = new URLSearchParams(window.location.search);
        const targetSite = urlParams.get('site');
        
        let apiUrl = `http://20.222.122.108:5000/graph-data?user_id=${userId}`;
        if (targetSite) apiUrl += `&site=${encodeURIComponent(targetSite)}`;

        const response = await fetch(apiUrl);
        const data = await response.json();

        // ต้องเก็บ Nodes ก่อน Edges เพื่อให้ calculateStats ค้นหา Domain ได้
        rawNodes = data.nodes || [];
        rawEdges = data.edges || [];

        calculateStats(rawEdges);
        applyFilterAndRender();

    } catch (err) {
        console.error("Graph Load Error:", err);
    }
}

/**
 * กรองข้อมูลและวาดกราฟ
 */
function applyFilterAndRender() {
    const container = document.getElementById('mynetwork');
    const urlParams = new URLSearchParams(window.location.search);
    const targetSite = urlParams.get('site');

    // 1. ดึงค่าจาก Checkbox ที่ถูกเลือก
    const checkedValues = Array.from(document.querySelectorAll('.filter-check:checked'))
                               .map(cb => cb.value.toUpperCase());

    // 2. กรอง Edges โดยใช้เกณฑ์ตัดสินเดียวกันกับสีเส้น
    const filteredEdges = rawEdges.filter(edge => {
        const label = edge.label || "";
        const targetNode = rawNodes.find(n => n.id === edge.to);
        const domainName = targetNode ? targetNode.label : "";

        // ถ้าเข้าข่าย Tracking ให้เช็คว่าติ๊กช่อง TRACKING หรือไม่
        if (isTracking(label, domainName)) {
            return checkedValues.includes("TRACKING");
        }
        
        // สำหรับประเภทอื่นๆ
        const upperLabel = label.toUpperCase();
        if (upperLabel.includes('NECESSARY') || upperLabel.includes('STRICTLY')) return checkedValues.includes("STRICTLY") || checkedValues.includes("NECESSARY");
        if (upperLabel.includes('PERFORMANCE') || upperLabel.includes('ANALYTICS')) return checkedValues.includes("PERFORMANCE");
        if (upperLabel.includes('FUNCTIONALITY')) return checkedValues.includes("FUNCTIONALITY");
        
        return checkedValues.includes("UNKNOWN");
    });

    // 3. กรอง Nodes เพื่อซ่อนจุดที่ไม่มีเส้นเชื่อม
    const activeNodeIds = new Set();
    filteredEdges.forEach(e => { activeNodeIds.add(e.from); activeNodeIds.add(e.to); });
    const filteredNodes = rawNodes.filter(n => activeNodeIds.has(n.id));

    if (filteredNodes.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding-top:100px; font-family: sans-serif; color: #7f8c8d;">
            <h3>No data to display</h3>
            <p>Try selecting more categories or browse more websites.</p>
        </div>`;
        return;
    }

    // 4. เตรียมข้อมูล Visuals
    const processedNodes = filteredNodes.map(node => {
        if (targetSite && node.label === targetSite) {
            return {
                ...node,
                size: 40,
                color: { background: '#2ecc71', border: '#27ae60' },
                font: { size: 18, weight: 'bold' }
            };
        }
        return node;
    });

    const processedEdges = filteredEdges.map(edge => {
        let edgeColor = '#95a5a6'; 
        let label = edge.label || 'Unknown';
        
        const targetNode = rawNodes.find(n => n.id === edge.to);
        const domainName = targetNode ? targetNode.label : "";

        if (isTracking(label, domainName)) { 
            edgeColor = '#e74c3c'; 
            label = 'Ads / Tracking'; 
        } 
        else if (label.toUpperCase().includes('NECESSARY') || label.toUpperCase().includes('STRICTLY')) { 
            edgeColor = '#2ecc71'; 
            label = 'Strictly Necessary'; 
        } 
        else if (label.toUpperCase().includes('PERFORMANCE') || label.toUpperCase().includes('ANALYTICS')) { 
            edgeColor = '#f1c40f'; 
            label = 'Performance'; 
        } 
        else if (label.toUpperCase().includes('FUNCTIONALITY')) { 
            edgeColor = '#3498db'; 
            label = 'Functionality'; 
        }

        return {
            ...edge,
            label: label,
            color: { color: edgeColor, highlight: '#2c3e50', opacity: 0.8 },
            width: 3, 
            font: { 
                size: 11, align: 'top', color: edgeColor, 
                background: '#ffffff', strokeWidth: 3, strokeColor: '#ffffff' 
            }
        };
    });

    // 5. วาดกราฟ
    const networkData = { 
        nodes: new vis.DataSet(processedNodes), 
        edges: new vis.DataSet(processedEdges) 
    };

    const options = {
        nodes: { shape: 'dot', size: 28, font: { face: 'Segoe UI, Tahoma, sans-serif' } },
        groups: {
            website: { color: { background: '#2ecc71', border: '#27ae60' } },
            tracker: { color: { background: '#e74c3c', border: '#c0392b' } }
        },
        edges: { arrows: { to: { enabled: true, scaleFactor: 0.5 } }, smooth: { type: 'curvedCW', roundness: 0.15 } },
        physics: {
            enabled: true,
            barnesHut: { gravitationalConstant: -12000, centralGravity: 0.3, springLength: 180, springConstant: 0.04, damping: 0.09 },
            stabilization: { iterations: 100, updateInterval: 25 }
        },
        interaction: { hover: true, tooltipDelay: 200 }
    };

    if (network) network.destroy();
    network = new vis.Network(container, networkData, options);
}