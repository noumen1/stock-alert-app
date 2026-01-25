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
function loadData() {
    const stored = localStorage.getItem('alert_system_data');
    if (stored) {
        data = JSON.parse(stored);
    } else {
        data = JSON.parse(JSON.stringify(defaultData)); 
    }
}

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

function deleteGroup(groupName) {
    if (Object.keys(data).length <= 1) { alert("Keep at least one list."); return; }
    if (confirm(`Delete list "${groupName}"?`)) {
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

    if (list.length === 0) {
        listViewContent.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">No alerts set in this list.</div>';
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
        // Symbol: ▲ or ▼
        const symbol = item.condition === 'above' ? '▲' : '▼';
        badge.textContent = `${symbol} ${item.price}`;
        alertDiv.appendChild(badge);

        // 3. Description
        const descDiv = document.createElement('div');
        descDiv.className = 'col-desc';
        descDiv.textContent = item.description;
        descDiv.title = item.description; // Tooltip for full text

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
        await fetch('http://localhost:3000/api/sync-alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data) // Send our entire data object
        });
        console.log("Sent data to server.");
    } catch (error) {
        console.error("Could not sync with server (is it running?)", error);
    }
}