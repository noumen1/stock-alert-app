// 1. Initial Data
const defaultData = {
    "Tech Watch": [
        { ticker: "AAPL", price: "175.50", condition: "below", description: "Buy the dip if it hits this level." },
        { ticker: "NVDA", price: "450.00", condition: "above", description: "Breakout alert. Watch volume." }
    ],
    "Crypto": [
        { ticker: "BTC", price: "60000", condition: "above", description: "Moon bag target." }
    ]
};

// 2. State
let data = {};          
let currentGroup = "";
let editingIndex = null; // Track if we are editing a specific row

// 3. DOM Elements
const headerTitle = document.getElementById('header-title');
const groupListContainer = document.getElementById('group-list');
const listViewContent = document.getElementById('list-view-content');

// Form Elements
const formTitle = document.getElementById('form-title');
const inputTicker = document.getElementById('input-ticker');
const inputPrice = document.getElementById('input-price');
const inputCondition = document.getElementById('input-condition');
const inputDescription = document.getElementById('input-description');
const saveBtn = document.getElementById('save-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');

// Sidebar Inputs
const newGroupNameInput = document.getElementById('new-group-name');
const addGroupBtn = document.getElementById('add-group-btn');

// 4. STORAGE & INIT
// Replace your existing loadData() function with this async version:
async function loadData() {
    try {
        const response = await fetch('https://my-stock-alerts.onrender.com/api/alerts');
        const dbAlerts = await response.json();

        // 1. Restore structure from localStorage to keep your custom list names
        const stored = localStorage.getItem('alert_system_data');
        if (stored) {
            data = JSON.parse(stored);
            Object.keys(data).forEach(key => data[key] = []); // Empty them to refill from DB
        } else {
            data = { "Altucher Daytrade": [] };
        }

        if (!data["Altucher Daytrade"]) data["Altucher Daytrade"] = [];

        // 2. Populate alerts
        dbAlerts.forEach(alert => {
            if (alert.description === 'Altucher 9.5% Drop') {
                data["Altucher Daytrade"].push(alert);
            } else {
                // Try to place manual alerts in a custom list, fallback to "Manual Alerts"
                const customGroups = Object.keys(data).filter(g => g !== "Altucher Daytrade");
                const targetGroup = customGroups.length > 0 ? customGroups[0] : "Manual Alerts";
                if (!data[targetGroup]) data[targetGroup] = [];
                data[targetGroup].push(alert);
            }
        });

        // 3. Clean up: If "Manual Alerts" is empty and you didn't explicitly save it, remove it
        if (data["Manual Alerts"] && data["Manual Alerts"].length === 0) {
            const storedRaw = stored ? JSON.parse(stored) : {};
            if (!storedRaw["Manual Alerts"]) delete data["Manual Alerts"];
        }

        renderSidebar();
        
        // Switch to Altucher list by default if populated
        if (data["Altucher Daytrade"].length > 0 && !currentGroup) {
            switchGroup("Altucher Daytrade");
        } else if (!currentGroup) {
            const firstGroup = Object.keys(data)[0];
            if (firstGroup) switchGroup(firstGroup);
        }
    } catch (error) {
        console.error("Failed to load from server", error);
    }
}

// Modify your init() function slightly to handle the async loadData
async function init() {
    await loadData();
}

// Wire up the new Altucher Generation Button (Add this at the bottom of script.js)
document.getElementById('generate-altucher-btn').addEventListener('click', async () => {
    const msg = "This will clear yesterday's Altucher alerts and generate new ones for the NDQ 100 based on the last closing price.\n\nIt takes ~2 minutes due to API rate limits. Proceed?";
    if (confirm(msg)) {
        try {
            await fetch('https://my-stock-alerts.onrender.com/api/generate-altucher', { method: 'POST' });
            alert("Generation started! The alerts will populate in the background over the next 2 minutes. Refresh this page shortly to see them.");
        } catch (error) {
            console.error("Error triggering generation:", error);
            alert("Failed to start generation.");
        }
    }
});

function saveData() {
    localStorage.setItem('alert_system_data', JSON.stringify(data));
    syncWithServer(); // <--- ADD THIS LINE
}

function init() {
    loadData();
    // Use default if empty
    if (Object.keys(data).length === 0) data = JSON.parse(JSON.stringify(defaultData));
    
    renderSidebar();
    
    // Select first group (Newest First logic)
    const firstGroup = Object.keys(data).reverse()[0]; 
    if(firstGroup) switchGroup(firstGroup);
}

// 5. SIDEBAR LOGIC
function renderSidebar() {
    groupListContainer.innerHTML = ''; 
    const keys = Object.keys(data).reverse(); // Newest first

    keys.forEach(groupName => {
        const item = document.createElement('div');
        item.className = 'group-item';
        if (groupName === currentGroup) item.classList.add('active');
        
        const textSpan = document.createElement('span');
        textSpan.textContent = groupName;
        textSpan.onclick = () => switchGroup(groupName); 
        
        const deleteIcon = document.createElement('span');
        deleteIcon.textContent = '×';
        deleteIcon.className = 'delete-group-icon';
        deleteIcon.onclick = (e) => {
            e.stopPropagation();
            deleteGroup(groupName);
        };

        item.appendChild(textSpan);
        item.appendChild(deleteIcon);
        groupListContainer.appendChild(item);
    });
}

function switchGroup(groupName) {
    cancelEditMode(); // Reset form if switching
    currentGroup = groupName;
    headerTitle.textContent = currentGroup;
    renderSidebar();
    renderList();
}

function addGroup() {
    const name = newGroupNameInput.value.trim();
    if (!name) return;
    if (data[name]) {alert("List exists!"); return;}

    data[name] = []; 
    saveData();
    newGroupNameInput.value = '';
    renderSidebar();
    switchGroup(name); 
}

async function deleteGroup(groupName) {
    if (Object.keys(data).length <= 1) { alert("Keep at least one list."); return; }
    
    if (confirm(`Delete list "${groupName}"?`)) {
        
        // If deleting the Altucher list, explicitly tell the database to drop the safety lock
        if (groupName === 'Altucher Daytrade') {
            try {
                // REPLACE with your actual Render URL
                await fetch('https://my-stock-alerts.onrender.com/api/clear-altucher', { method: 'DELETE' });
            } catch (e) { 
                console.error("Failed to clear Altucher from DB", e); 
            }
        }

        delete data[groupName];
        saveData();
        const remaining = Object.keys(data).reverse();
        switchGroup(remaining[0]);
    }
}

// 6. LIST LOGIC
function renderList() {
    const list = data[currentGroup] || [];
    listViewContent.innerHTML = ''; 

    // --- NDQ 100 MISSING STOCKS VALIDATION ---
    if (currentGroup === 'Altucher Daytrade') {
        const NDQ_100 = ['ADBE','AMD','ABNB','ALNY','GOOGL','GOOG','AMZN','AEP','AMGN','ADI','AAPL','AMAT','APP','ARM','ASML','ADSK','ADP','AXON','BKR','BKNG','AVGO','CDNS','CHTR','CTAS','CSCO','CCEP','CTSH','CMCSA','CEG','CPRT','CSGP','COST','CRWD','CSX','DDOG','DXCM','FANG','DASH','EA','EXC','FAST','FER','FTNT','GEHC','GILD','HON','IDXX','INSM','INTC','INTU','ISRG','KDP','KLAC','KHC','LRCX','LIN','MAR','MRVL','MELI','META','MCHP','MU','MSFT','MSTR','MDLZ','MPWR','MNST','NFLX','NVDA','NXPI','ORLY','ODFL','PCAR','PLTR','PANW','PAYX','PYPL','PDD','PEP','QCOM','REGN','ROP','ROST','SNDK','STX','SHOP','SBUX','SNPS','TMUS','TTWO','TSLA','TXN','TRI','VRSK','VRTX','WMT','WBD','WDC','WDAY','XEL','ZS'];
        
        const currentTickers = list.map(a => a.ticker.toUpperCase());
        const missing = NDQ_100.filter(t => !currentTickers.includes(t));
        
        if (missing.length > 0) {
            const warning = document.createElement('div');
            warning.style.padding = '12px';
            warning.style.backgroundColor = '#fdedec';
            warning.style.color = '#c0392b';
            warning.style.marginBottom = '15px';
            warning.style.borderRadius = '6px';
            warning.innerHTML = `<strong>⚠️ Missing ${missing.length} Stocks (API Drops):</strong><br> <span style="font-size: 0.85em;">${missing.join(', ')}</span><br><br>`;
            
            // Generate the Retry Button dynamically
            const retryBtn = document.createElement('button');
            retryBtn.textContent = '🔄 Retry Missing Stocks';
            retryBtn.style.padding = '8px 15px';
            retryBtn.style.backgroundColor = '#c0392b';
            retryBtn.style.color = 'white';
            retryBtn.style.border = 'none';
            retryBtn.style.borderRadius = '4px';
            retryBtn.style.cursor = 'pointer';
            retryBtn.style.fontWeight = 'bold';
            
            retryBtn.onclick = async () => {
                retryBtn.disabled = true;
                retryBtn.textContent = '⏳ Retrying...';
                retryBtn.style.backgroundColor = '#95a5a6';
                
                try {
                    // Send the specific missing tickers to the backend
                    await fetch('https://my-stock-alerts.onrender.com/api/retry-altucher', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tickers: missing })
                    });
                    
                    const estTime = Math.ceil((missing.length * 1.2) / 60);
                    alert(`Retry started for ${missing.length} stocks. This will take ~${estTime} minute(s) in the background. Refresh the page shortly.`);
                } catch (err) {
                    alert("Failed to send retry request.");
                    retryBtn.disabled = false;
                    retryBtn.textContent = '🔄 Retry Missing Stocks';
                    retryBtn.style.backgroundColor = '#c0392b';
                }
            };
            
            warning.appendChild(retryBtn);
            listViewContent.appendChild(warning);
        } else if (list.length > 0) {
            const success = document.createElement('div');
            success.style.padding = '12px';
            success.style.backgroundColor = '#e8f8f5';
            success.style.color = '#27ae60';
            success.style.marginBottom = '15px';
            success.style.borderRadius = '6px';
            success.innerHTML = `<strong>✅ All 100 NDQ stocks loaded successfully.</strong>`;
            listViewContent.appendChild(success);
        }
    }

    if (list.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.padding = '20px';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.color = '#999';
        emptyMsg.textContent = 'No alerts set in this list.';
        listViewContent.appendChild(emptyMsg);
        return;
    }

    list.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'list-row';

        // 1. Ticker
        const tickerDiv = document.createElement('div');
        tickerDiv.className = 'col-ticker';
        tickerDiv.textContent = item.ticker;

        // 2. Alert (Price + Condition)
        const alertDiv = document.createElement('div');
        alertDiv.className = 'col-alert';
        
        const badge = document.createElement('span');
        badge.className = `alert-tag alert-${item.condition}`;
        const symbol = item.condition === 'above' ? '▲' : '▼';
        badge.textContent = `${symbol} ${item.price}`;
        alertDiv.appendChild(badge);

        // 3. Description
        const descDiv = document.createElement('div');
        descDiv.className = 'col-desc';
        descDiv.textContent = item.description;
        descDiv.title = item.description;

        // 4. Actions
        const actionDiv = document.createElement('div');
        actionDiv.className = 'col-actions';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'row-btn btn-edit';
        editBtn.textContent = '✎';
        editBtn.onclick = () => loadItemIntoForm(index);

        const delBtn = document.createElement('button');
        delBtn.className = 'row-btn btn-delete';
        delBtn.textContent = '🗑';
        delBtn.onclick = () => deleteItem(index);

        actionDiv.appendChild(editBtn);
        actionDiv.appendChild(delBtn);

        row.appendChild(tickerDiv);
        row.appendChild(alertDiv);
        row.appendChild(descDiv);
        row.appendChild(actionDiv);
        
        listViewContent.appendChild(row);
    });
}

function deleteItem(index) {
    if(confirm("Remove this alert?")) {
        data[currentGroup].splice(index, 1);
        saveData();
        renderList();
        if (editingIndex === index) cancelEditMode(); // If deleting the one being edited
    }
}

// 7. FORM LOGIC (Add & Edit)

function loadItemIntoForm(index) {
    const item = data[currentGroup][index];
    
    // Fill inputs
    inputTicker.value = item.ticker;
    inputPrice.value = item.price;
    inputCondition.value = item.condition;
    inputDescription.value = item.description;

    // Set State
    editingIndex = index;
    
    // UI Update
    formTitle.textContent = "Edit Alert";
    saveBtn.textContent = "Update Alert";
    cancelEditBtn.classList.remove('hidden');
    
    // Highlight row? (Optional)
    
    // Scroll to form
    document.querySelector('.form-container').scrollIntoView({ behavior: 'smooth' });
}

function cancelEditMode() {
    editingIndex = null;
    inputTicker.value = '';
    inputPrice.value = '';
    inputDescription.value = '';
    inputCondition.value = 'above'; // Reset default
    
    formTitle.textContent = "Add New Alert";
    saveBtn.textContent = "Add Alert";
    cancelEditBtn.classList.add('hidden');
}

function saveItem() {
    const ticker = inputTicker.value.trim().toUpperCase();
    const price = inputPrice.value.trim();
    const condition = inputCondition.value;
    const desc = inputDescription.value.trim();

    if (!ticker || !price) {
        alert("Ticker and Price are required.");
        return;
    }

    const newItem = {
        id: Date.now(), // <--- ADD THIS LINE (Unique ID)
        ticker: ticker,
        price: price,
        condition: condition,
        description: desc,
        triggered: false // <--- ADD THIS (Default state)
    };

    if (editingIndex !== null) {
        // Keep the old ID if editing
        const oldId = data[currentGroup][editingIndex].id;
        newItem.id = oldId; 
        data[currentGroup][editingIndex] = newItem;
    } else {
        data[currentGroup].push(newItem);
    }

    saveData();
    renderList();
    cancelEditMode();
}

// 8. EVENT LISTENERS
addGroupBtn.addEventListener('click', addGroup);
saveBtn.addEventListener('click', saveItem);
cancelEditBtn.addEventListener('click', cancelEditMode);

// Init
init();

// --- SERVER SYNC ---
async function syncWithServer() {
    try {
        // REPLACE 'https://your-app-name.onrender.com' WITH YOUR ACTUAL RENDER URL
        await fetch('https://my-stock-alerts.onrender.com/api/sync-alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        console.log("Sent data to server.");
    } catch (error) {
        console.error("Could not sync with server", error);
    }
}