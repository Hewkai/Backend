let cookieData = [];
let currentPage = 1;    
let cookieLogInterval = null;
const itemsPerPage = 10;
document.addEventListener('DOMContentLoaded', () => {
    
    // --- NAVIGATION LOGIC ---
    const pages = {
        home: document.getElementById('homePage'),
        // ซ่อนตัวแปร history 
        // history: document.getElementById('historyPage'), 
        setting: document.getElementById('settingPage'),
        cookieLog: document.getElementById('cookieLogPage')
    };
    const headerTitle = document.getElementById('headerTitle');
    const backBtn = document.getElementById('backBtn');

    function showPage(pageName, title) {

    Object.values(pages).forEach(p => {
        if (p) p.classList.remove('active');
    });

    if (pages[pageName]) pages[pageName].classList.add('active');

    headerTitle.innerText = title;

    backBtn.style.display = pageName === 'home' ? 'none' : 'block';

    // stop auto refresh when leaving cookie log
    if(pageName !== 'cookieLog' && cookieLogInterval){
        clearInterval(cookieLogInterval);
        cookieLogInterval = null;
    }
    }

    // --- ซ่อนการคลิกปุ่ม History ---
    // document.getElementById('goHistory').addEventListener('click', () => {
    //     showPage('history', 'History');
    //     loadHistory();
    // });
    document.querySelectorAll('.cookie-filter input').forEach(cb=>{
    cb.addEventListener('change',()=>{
        currentPage = 1;
        renderCookiePage();
    });
});


const btnCookieLog = document.getElementById('btnCookieLog');


if (btnCookieLog) {
    btnCookieLog.addEventListener('click', () => {
        showPage('cookieLog', 'Cookie Log');

        loadCookieLog();

        // refresh every 3 seconds
        if(cookieLogInterval) clearInterval(cookieLogInterval);
        cookieLogInterval = setInterval(loadCookieLog, 3000);
    });
}


    document.getElementById('goSetting').addEventListener('click', () => showPage('setting', 'Settings'));
    backBtn.addEventListener('click', () => showPage('home', 'CookiesChecker'));

    // --- GRAPH LOGIC (ปรับปรุงตามขั้นตอนที่ 3) ---
    const btnGraph = document.getElementById('btnOpenGraph');
    if (btnGraph) {
        btnGraph.addEventListener('click', async () => {
            try {
                // 1. ดึงข้อมูล Tab ปัจจุบันที่กำลัง Active อยู่
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                
                if (tab && tab.url && tab.url.startsWith('http')) {
                    const url = new URL(tab.url);
                    const domain = url.hostname;
                    // 2. เปิดหน้ากราฟพร้อมส่ง Domain ปัจจุบันไปใน Query String (?site=...)
                    chrome.tabs.create({ url: `graph.html?site=${encodeURIComponent(domain)}` });
                } else {
                    // กรณีเปิดหน้า Browser พิเศษ (เช่น chrome://) ให้เปิดกราฟรวมปกติ
                    chrome.tabs.create({ url: 'graph.html' });
                }
            } catch (e) {
                console.error("Error opening graph:", e);
                chrome.tabs.create({ url: 'graph.html' });
            }
        });
    }

    // --- SETTING TABS LOGIC ---
    const navTabs = document.querySelectorAll('.nav-tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const saveBtn = document.getElementById('saveSetting'); 

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            navTabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');
            if (targetId === 'tabAbout') {
                saveBtn.style.display = 'none';
            } else {
                saveBtn.style.display = 'block';
            }
        });
    });

    // --- HOME LOGIC ---
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if(tabs[0]) {
            try {
                const url = new URL(tabs[0].url);
                document.getElementById('currentDomain').innerText = url.hostname;
            } catch (e) {
                document.getElementById('currentDomain').innerText = "Unknown";
            }
        }
    });

    //threat count
    chrome.storage.local.get(["threatCount"], (res) => {

        const count = res.threatCount || 0;

        const threatEl = document.getElementById("threatCounter");

        if(threatEl){
            threatEl.textContent = `Potential Threat : ${count}`;
        }
        });

    chrome.storage.onChanged.addListener((changes) => {

        if(changes.threatCount){

            const count = changes.threatCount.newValue;

            const threatEl = document.getElementById("threatCounter");

            if(threatEl){
                threatEl.textContent = `Potential Threat : ${count}`;
            }

        }
    });

    // --- HISTORY LOGIC (ซ่อนการดึงข้อมูลจาก Server) ---
    /*
    async function loadHistory() {
        const listDiv = document.getElementById('historyList');
        listDiv.innerHTML = '<p style="text-align:center; color:#aaa;">Loading...</p>';
        try {
            const res = await fetch('http://127.0.0.1:5000/history');
            const data = await res.json();
            listDiv.innerHTML = '';
            if(data.length === 0) {
                listDiv.innerHTML = '<p style="text-align:center;">No history yet.</p>';
                return;
            }
            data.forEach(item => {
                let labels = item.labels.replace("Targeting or Advertising Cookies", "Ads/Tracking")
                                        .replace("Performance Cookies", "Performance")
                                        .replace("Functionality Cookies", "Functionality");
                const html = `
                    <div class="card">
                        <div class="card-title">${item.domain}</div>
                        <div style="font-size:11px; color:#E91E63; margin-top:2px;">${labels}</div>
                    </div>`;
                listDiv.innerHTML += html;
            });
        } catch (err) {
            listDiv.innerHTML = '<p style="text-align:center; color:red;">Cannot connect to Server</p>';
        }
    }
    */
   function getDomain(item){
    if(item.domain) return item.domain.replace(/^\./,'');
    if(item.site) return item.site;
    if(item.host) return item.host;

    if(item.url){
        try{
            return new URL(item.url).hostname;
        }catch(e){}
    }

    return "Unknown domain";}

let firstLoad = true;

async function loadCookieLog() {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    let domain = tab?.url ? new URL(tab.url).hostname : "";
    if (domain.startsWith("www.")) domain = domain.slice(4);
    // Remove "www." prefix
    if (domain.startsWith("www.")) domain = domain.slice(4);

    const listDiv = document.getElementById('cookieLogList');

    if(firstLoad){
        listDiv.innerHTML = `
        <div class="cookie-loading">
            <div class="cookie-loading-text">Loading cookie log...</div>
            <div class="cookie-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>`;
    }

    try {
    const res = await fetch(`http://127.0.0.1:5000/history?site=${domain}&ts=${Date.now()}`);
    if(!res.ok){
        throw new Error("Server response error: " + res.status);
    }
        const newData = (await res.json());
        console.log("API Response:", newData);

        const dedupedData = [...new Map(newData.map(c => [c.name + c.domain, c])).values()];
        if (JSON.stringify(dedupedData) !== JSON.stringify(cookieData)) {
            cookieData = dedupedData;
            currentPage = 1;
        }

        firstLoad = false;
        renderCookiePage();
 
    } catch(err){
        console.error("Server Error:", err);
        listDiv.innerHTML =
        '<p style="text-align:center;color:red;">Cannot connect to server</p>';
    }}

    
        
        

    function renderCookiePage(){
    const checked = [...document.querySelectorAll('.cookie-filter input:checked')]
    .map(c => c.value);

    const listDiv = document.getElementById('cookieLogList');

    const filtered = cookieData.filter(c => {
        let label = (c.label || c.labels || "Unknown").toLowerCase();
        if (label.includes("necessary")) label = "Necessary";
        else if (label.includes("performance")) label = "Performance";
        else if (label.includes("functionality")) label = "Functionality";
        else if (label.includes("advertising") || label.includes("tracking")) label = "Tracking";
        else label = "Unknown";

        return checked.includes(label);
    });

    const start = (currentPage-1) * itemsPerPage;
    const pageItems = filtered.slice(start, start + itemsPerPage);

    listDiv.innerHTML = '';

    pageItems.forEach(item => {

    const label = item.label || item.labels || "Unknown";
    const domain = item.domain || "Unknown";
    const name = item.name || "Unnamed Cookie";

    const maxLength = 30; // max characters to display

    const html = `
    <div class="card">
        <div class="card-title">${domain.length > maxLength ? domain.slice(0, maxLength) + '...' : domain}</div>
        <div class="cookie-name">${name.length > maxLength ? name.slice(0, maxLength) + '...' : name}</div>
        <div class="cookie-label">${label}</div>
    </div>
    `;
        console.log("Cookie Log Data:", cookieData);
        listDiv.innerHTML += html;

    });

    renderPagination(filtered.length);
    document.getElementById("cookieLogPage").scrollTop = 0;
}
    
function renderPagination(total){

    const pageCount = Math.max(1, Math.ceil(total / itemsPerPage));

    const container = document.getElementById("cookiePagination");

    container.innerHTML = `
        <button ${currentPage===1?'disabled':''}>Prev</button>
        <span>Page ${currentPage}/${pageCount}</span>
        <button ${currentPage===pageCount?'disabled':''}>Next</button>
    `;

    const buttons = container.querySelectorAll("button");

    buttons[0].onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            renderCookiePage();
        }
    };

    buttons[1].onclick = () => {
        if (currentPage < pageCount) {
            currentPage++;
            renderCookiePage();
        }
    };}

    // --- SETTINGS LOGIC ---
    const settingsKeys = ["Performance Cookies", "Functionality Cookies", "Targeting or Advertising Cookies", "enableNotify", "autoFilter"];
    chrome.storage.local.get(['settings'], (result) => {
        const settings = result.settings || {};
        settingsKeys.forEach(key => {
            const el = document.getElementById(key);
            if (el) el.checked = settings[key] !== false; 
        });
    });

    document.getElementById('saveSetting').addEventListener('click', () => {
        const settings = {};
        settingsKeys.forEach(key => {
            const el = document.getElementById(key);
            if(el) settings[key] = el.checked;
        });
        settings["Strictly Necessary Cookies"] = true; 
        chrome.storage.local.set({ settings }, () => {
            const btn = document.getElementById('saveSetting');
            const oldText = btn.innerText;
            btn.innerText = "Saved!";
            btn.style.background = "#28a745";
            setTimeout(() => {
                btn.innerText = oldText;
                btn.style.background = "#4CAF50";
            }, 1500);
            chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings });
        });
    });

    const themeSelect = document.getElementById("themeSelect");

    chrome.storage.local.get(["theme"], (res)=>{
        const theme = res.theme || "light";

        themeSelect.value = theme;

        if(theme === "dark"){
            document.body.classList.add("dark");
        }
    });

    themeSelect.addEventListener("change", ()=>{
        const selected = themeSelect.value;

        if(selected === "dark"){
            document.body.classList.add("dark");
        }else{
            document.body.classList.remove("dark");
        }

        chrome.storage.local.set({theme:selected});
    });
    console.log("Fetching cookies for domain:", domain);

});