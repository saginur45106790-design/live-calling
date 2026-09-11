let currentUser = null;
let currentProfileTarget = null;
let incomingSignalCache = null;
const socket = io();

// অথেনটিকেশন স্টেট চেক
window.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (token) {
        fetchCurrentUser();
    } else {
        showAuthScreen();
    }
    setupSocketEvents();
});

function showAuthScreen() {
    document.getElementById('auth-container').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
}

function switchAuthTab(type) {
    document.getElementById('tab-login-btn').classList.toggle('active', type === 'login');
    document.getElementById('tab-signup-btn').classList.toggle('active', type === 'signup');
    document.getElementById('login-form').classList.toggle('hidden', type !== 'login');
    document.getElementById('signup-form').classList.toggle('hidden', type !== 'signup');
}

// লগইন হ্যান্ডলার
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok) {
        localStorage.setItem('token', data.token);
        currentUser = data.user;
        initAppView();
    } else {
        alert(data.error);
    }
}

// সাইনআপ হ্যান্ডলার
async function handleSignup(e) {
    e.preventDefault();
    const username = document.getElementById('signup-username').value;
    const phone = document.getElementById('signup-phone').value;
    const password = document.getElementById('signup-password').value;
    const ref_code = document.getElementById('signup-refcode').value;

    const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, phone, password, ref_code })
    });
    const data = await res.json();

    if (res.ok) {
        localStorage.setItem('token', data.token);
        currentUser = data.user;
        initAppView();
    } else {
        alert(data.error);
    }
}

function handleLogout() {
    localStorage.removeItem('token');
    location.reload();
}

async function fetchCurrentUser() {
    const res = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) {
        currentUser = await res.json();
        initAppView();
    } else {
        handleLogout();
    }
}

function initAppView() {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    socket.emit('register_user', currentUser.id);
    updateWalletDisplay();
    loadHomeUsers();
}

function updateWalletDisplay() {
    document.getElementById('nav-coins').innerText = currentUser.coins;
    document.getElementById('wallet-coins-total').innerText = currentUser.coins;

    // উইথড্রল শর্ত অগ্রগতি আপডেট (৫০ মিনিট = ৩০০০ সেকেন্ড)
    const totalSecs = currentUser.total_call_seconds || 0;
    const totalMins = Math.floor(totalSecs / 60);
    const progressPercent = Math.min(100, Math.floor((totalMins / 50) * 100));

    document.getElementById('withdraw-progress').style.width = `${progressPercent}%`;
    document.getElementById('withdraw-progress-text').innerText = `${totalMins} / ৫০ মিনিট`;
}

// ভিউ চেঞ্জার
function showView(viewId) {
    document.querySelectorAll('.sub-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');

    if (viewId === 'home-view') loadHomeUsers();
    if (viewId === 'agency-view') loadAgencyData();
    if (viewId === 'support-view') loadSupportMessages();
}

// হোমপেজে সক্রিয় ইউজার লোড
async function loadHomeUsers() {
    const res = await fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const users = await res.json();

    const grid = document.getElementById('users-grid');
    grid.innerHTML = '';

    users.forEach(user => {
        const card = document.createElement('div');
        card.className = 'user-stream-card';
        card.innerHTML = `
            <div class="card-cover">
                <svg width="60" height="60" viewBox="0 0 24 24" fill="#6c7a9c"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            </div>
            <span class="live-badge">ONLINE</span>
            <div class="card-details">
                <h4>${user.username}</h4>
                <p style="font-size: 11px; color: #8b92a8;">লাইভ সময়: ${Math.floor(user.total_call_seconds / 60)} মিনিট</p>
            </div>
        `;
        card.onclick = () => openUserProfile(user.id);
        grid.appendChild(card);
    });
}

// ইউজারের প্রোফাইলে যাওয়া
async function openUserProfile(userId) {
    const res = await fetch(`/api/users/${userId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const user = await res.json();
    currentProfileTarget = user;

    document.getElementById('prof-name').innerText = user.username;
    document.getElementById('prof-agency-tag').innerText = user.agency_id ? `এজেন্সি আইডি: ${user.agency_id}` : 'স্বতন্ত্র ইউজার';
    document.getElementById('prof-total-time').innerText = `${Math.floor(user.total_call_seconds / 60)} মিনিট`;
    document.getElementById('prof-coins').innerText = user.coins;
    document.getElementById('prof-ref-code').value = `${window.location.origin}?ref=${user.ref_code}`;

    showView('profile-view');
}

function showMyProfile() {
    if (currentUser) openUserProfile(currentUser.id);
}

function initiateCall() {
    if (!currentProfileTarget) return;
    if (currentProfileTarget.id === currentUser.id) {
        alert('নিজের আইডিতে কল করা সম্ভব নয়!');
        return;
    }
    startVideoCall(currentProfileTarget.id);
}

function copyReferralLink() {
    const copyText = document.getElementById('prof-ref-code');
    copyText.select();
    document.execCommand('copy');
    alert('রেফারেল লিংক কপি হয়েছে!');
}

// কয়েন রিচার্জ
async function rechargeCoins(amount) {
    const res = await fetch('/api/recharge', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ coins: amount })
    });
    if (res.ok) {
        alert(`${amount} কয়েন যোগ হয়েছে!`);
        fetchCurrentUser();
    }
}

// উইথড্রল রিকোয়েস্ট সাবমিট
async function handleWithdraw(e) {
    e.preventDefault();
    const payment_method = document.getElementById('withdraw-method').value;
    const account_number = document.getElementById('withdraw-account').value;

    const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ payment_method, account_number })
    });

    const data = await res.json();
    if (res.ok) {
        alert(data.message);
        fetchCurrentUser();
    } else {
        alert(data.error);
    }
}

// এজেন্সি ডাটা লোড
async function loadAgencyData() {
    const res = await fetch('/api/agency', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await res.json();

    const list = document.getElementById('agency-members-list');
    list.innerHTML = '';

    if (data.members.length === 0) {
        list.innerHTML = '<p style="color: #8b92a8; font-size: 13px;">কোনো সদস্য যুক্ত হয়নি এখনো।</p>';
        return;
    }

    data.members.forEach(m => {
        const item = document.createElement('div');
        item.style.cssText = 'background: #24283b; padding: 10px; border-radius: 8px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;';
        item.innerHTML = `
            <div>
                <strong>${m.username} (ID: ${m.id})</strong>
                <p style="font-size: 12px; color: #8b92a8;">কল টাইম: ${Math.floor(m.total_call_seconds / 60)} মিনিট | কয়েন: ${m.coins}</p>
            </div>
        `;
        list.appendChild(item);
    });
}

// এজেন্সি গিফট কয়েন পাঠানো
async function giftCoinsToMember() {
    const member_id = document.getElementById('gift-member-id').value;
    const amount = document.getElementById('gift-coins-amount').value;

    const res = await fetch('/api/agency/gift', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ member_id, amount })
    });
    const data = await res.json();
    alert(data.message || data.error);
    if (res.ok) fetchCurrentUser();
}

// সাপোর্ট মেসেজ
async function loadSupportMessages() {
    const res = await fetch('/api/support/messages', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const messages = await res.json();

    const body = document.getElementById('chat-messages');
    body.innerHTML = '';

    messages.forEach(m => {
        const div = document.createElement('div');
        div.className = `chat-msg ${m.sender_id === currentUser.id ? 'mine' : 'other'}`;
        div.innerText = m.message;
        body.appendChild(div);
    });
    body.scrollTop = body.scrollHeight;
}

async function sendSupportMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const msg = input.value;

    const res = await fetch('/api/support/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ message: msg })
    });
    if (res.ok) {
        input.value = '';
        loadSupportMessages();
    }
}

// Socket.io ইভেন্টস
function setupSocketEvents() {
    socket.on('incoming_call', ({ fromUserId, signalData }) => {
        incomingSignalCache = { fromUserId, signalData };
        document.getElementById('caller-id-display').innerText = `ইউজার ID: ${fromUserId} থেকে কল এসেছে`;
        document.getElementById('incoming-call-alert').classList.remove('hidden');
    });

    socket.on('call_accepted', async ({ signalData, callId }) => {
        currentActiveCallId = callId;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signalData));
        startCallTimer();
    });

    socket.on('call_started', ({ callId }) => {
        currentActiveCallId = callId;
        startCallTimer();
    });

    socket.on('ice_candidate', async ({ candidate }) => {
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });

    socket.on('call_ended', (data) => {
        cleanUpCallMedia();
        alert(data.message);
        fetchCurrentUser();
    });

    socket.on('call_failed', (data) => {
        cleanUpCallMedia();
        alert(data.message);
    });
}

function acceptIncomingCall() {
    document.getElementById('incoming-call-alert').classList.add('hidden');
    if (incomingSignalCache) {
        acceptCallWithSignal(incomingSignalCache.fromUserId, incomingSignalCache.signalData);
    }
}

function rejectIncomingCall() {
    document.getElementById('incoming-call-alert').classList.add('hidden');
    incomingSignalCache = null;
                                              }
