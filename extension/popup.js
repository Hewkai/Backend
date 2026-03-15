let cookieData = [];
let currentPage = 1;    
let cookieLogInterval = null;
const itemsPerPage = 10;
let firstLoad = true;

document.addEventListener('DOMContentLoaded', () => {
    
    // --- NAVIGATION LOGIC ---
    const pages = {
        home: document.getElementById('homePage'),
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

    document.querySelectorAll('.cookie-filter input').forEach(cb => {
        cb.addEventListener('change', () => {
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

    // --- GRAPH LOGIC ---
    const btnGraph = document.getElementById('btnOpenGraph');
    if (btnGraph) {
        btnGraph.addEventListener('click', async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                
                if (tab && tab.url && tab.url.startsWith('http')) {
                    const url = new URL(tab.url);
                    const domain = url.hostname;
                    chrome.tabs.create({ url: `graph.html?site=${encodeURIComponent(domain)}` });
                } else {
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

    // threat count
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

    // --- COOKIE LOG API FETCHING ---
    async function loadCookieLog() {
        const listDiv = document.getElementById('cookieLogList');

        if(firstLoad){
            listDiv.innerHTML = `
            <div class="cookie-loading" style="text-align:center; padding: 20px;">
                <div class="cookie-loading-text">Loading cookie log...</div>
            </div>`;
        }

        try {
            // ดึงข้อมูลทั้งหมดจากเซิร์ฟเวอร์ และแนบ ts เพื่อกัน Chrome จำ Cache
            const res = await fetch(`http://20.222.122.108:5000/history?ts=${Date.now()}`);
            if(!res.ok){
                throw new Error("Server response error: " + res.status);
            }
            const newData = await res.json();
            console.log("Data from API:", newData);

            const dedupedData = [...new Map(newData.map(c => [c.name + c.domain, c])).values()];
            if (JSON.stringify(dedupedData) !== JSON.stringify(cookieData)) {
                cookieData = dedupedData;
                currentPage = 1;
            }

            firstLoad = false;
            renderCookiePage();
     
        } catch(err){
            console.error("Server Error:", err);
            listDiv.innerHTML = '<p style="text-align:center;color:red;">Cannot connect to server</p>';
        }
    }

    // --- RENDER COOKIE LOG ---
    function renderCookiePage(){
        // 1. ดึงค่าจาก Checkbox แบบกันเหนียว (ถ้า HTML ลืมใส่ value="xxx" เราจะดึงข้อความข้างๆ มาใช้แทน)
        const checked = [...document.querySelectorAll('.cookie-filter input:checked')].map(c => {
            let val = c.value;
            if (val === "on" || !val) {
                val = c.parentElement.innerText.trim() || c.id || "unknown";
            }
            return val.toLowerCase();
        });

        console.log("Filters checked:", checked);

        const listDiv = document.getElementById('cookieLogList');

        // 2. กรองข้อมูล
        const filtered = cookieData.filter(c => {
            let label = (c.label || c.labels || "unknown").toLowerCase();
            
            // จัดหมวดหมู่
            if (label.includes("necessary") || label.includes("strictly")) label = "necessary";
            else if (label.includes("performance")) label = "performance";
            else if (label.includes("functionality")) label = "functionality";
            else if (label.includes("advertising") || label.includes("tracking")) label = "tracking";
            else label = "unknown";

            // เช็คว่าประเภทคุกกี้ตรงกับ Checkbox ที่ติ๊กไว้ไหม
            return checked.some(filterWord => filterWord.includes(label) || label.includes(filterWord));
        });

        console.log("Filtered Data (Ready to show):", filtered);

        const start = (currentPage-1) * itemsPerPage;
        const pageItems = filtered.slice(start, start + itemsPerPage);

        listDiv.innerHTML = '';

        // 3. ถ้ากรองแล้วไม่เจอข้อมูลเลย ให้ขึ้นข้อความบอก
        if (filtered.length === 0) {
            listDiv.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">No cookies match the selected filters or no data available.</div>';
        }

        // 4. วาดการ์ดแสดงคุกกี้
        pageItems.forEach(item => {
            const labelText = item.label || item.labels || "Unknown";
            const domain = item.domain || "Unknown";
            const name = item.name || "Unnamed Cookie";

            const maxLength = 30; // max characters to display

            const html = `
            <div class="card" style="padding: 10px; border-bottom: 1px solid #eee;">
                <div class="card-title" style="font-weight: bold; color: #333;">${domain.length > maxLength ? domain.slice(0, maxLength) + '...' : domain}</div>
                <div class="cookie-name" style="font-size: 12px; color: #777;">${name.length > maxLength ? name.slice(0, maxLength) + '...' : name}</div>
                <div class="cookie-label" style="font-size: 12px; color: #E91E63; margin-top: 5px; font-weight: bold;">${labelText}</div>
            </div>
            `;
            listDiv.innerHTML += html;
        });

        renderPagination(filtered.length);
        document.getElementById("cookieLogPage").scrollTop = 0;
    }
        
    function renderPagination(total){
        const pageCount = Math.max(1, Math.ceil(total / itemsPerPage));
        const container = document.getElementById("cookiePagination");

        if(!container) return;

        container.innerHTML = `
            <button ${currentPage===1?'disabled':''}>Prev</button>
            <span style="margin: 0 10px;">Page ${currentPage}/${pageCount}</span>
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
        };
    }

    // --- SETTINGS STORAGE ---
    const settingsKeys = ["Performance Cookies", "Functionality Cookies", "Targeting or Advertising Cookies", "enableNotify", "autoFilter"];
    chrome.storage.local.get(['settings'], (result) => {
        const settings = result.settings || {};
        settingsKeys.forEach(key => {
            const el = document.getElementById(key);
            if (el) el.checked = settings[key] !== false; 
        });
    });

    const saveSettingBtn = document.getElementById('saveSetting');
    if (saveSettingBtn) {
        saveSettingBtn.addEventListener('click', () => {
            const settings = {};
            settingsKeys.forEach(key => {
                const el = document.getElementById(key);
                if(el) settings[key] = el.checked;
            });
            settings["Strictly Necessary Cookies"] = true; 
            chrome.storage.local.set({ settings }, () => {
                const btn = document.getElementById('saveSetting');
                const oldText = btn.innerText;
                // btn.innerText = "Saved!";
                // btn.style.background = "#28a745";
                // setTimeout(() => {
                //     btn.innerText = oldText;
                //     btn.style.background = "#4CAF50";
                // }, 1500);
                showSaveToast();
                chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings });
            });
        });
    }

    const themeSelect = document.getElementById("themeSelect");
    if (themeSelect) {
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
    }

    function showSaveToast(){

        const popup = document.getElementById("savePopup");
        const confettiBox = document.getElementById("confetti");

        if(!popup) return;

        popup.classList.add("show");

        // create confetti
        confettiBox.innerHTML = "";
        for(let i=0;i<25;i++){

            const piece = document.createElement("div");
            piece.classList.add("confetti");

            piece.style.left = Math.random()*100 + "%";
            piece.style.background =
                ["#E91E63","#9C27B0","#4CAF50","#FFC107","#03A9F4"]
                [Math.floor(Math.random()*5)];

            piece.style.animationDelay = Math.random()*0.3+"s";

            confettiBox.appendChild(piece);
        }

        setTimeout(()=>{
            popup.classList.remove("show");
        },1800);
    }
   
});