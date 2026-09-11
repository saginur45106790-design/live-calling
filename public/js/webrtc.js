let localStream = null;
let remoteStream = null;
let peerConnection = null;
let activeTargetUserId = null;
let currentActiveCallId = null;
let callDurationInterval = null;
let callSecondsElapsed = 0;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// ক্যামেরা ও মাইক্রোফোন এক্সেস
async function initializeMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local-video').srcObject = localStream;
        return true;
    } catch (err) {
        alert('ক্যামেরা অথবা মাইক্রোফোন এক্সেস পাওয়া যায়নি!');
        return false;
    }
}

// পিয়ার কানেকশন প্রস্তুতকরণ
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        if (!remoteStream) {
            remoteStream = new MediaStream();
            document.getElementById('remote-video').srcObject = remoteStream;
        }
        remoteStream.addTrack(event.track);
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && activeTargetUserId) {
            socket.emit('ice_candidate', {
                toUserId: activeTargetUserId,
                candidate: event.candidate
            });
        }
    };
}

// ভিডিও কল শুরু করা (Caller)
async function startVideoCall(targetUserId) {
    const mediaReady = await initializeMedia();
    if (!mediaReady) return;

    activeTargetUserId = targetUserId;
    createPeerConnection();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('call_user', {
        toUserId: targetUserId,
        signalData: offer
    });

    document.getElementById('call-modal').classList.remove('hidden');
}

// ইনকামিং কল রিসিভ করা (Receiver)
async function acceptCallWithSignal(fromUserId, offerSignal) {
    const mediaReady = await initializeMedia();
    if (!mediaReady) return;

    activeTargetUserId = fromUserId;
    createPeerConnection();

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerSignal));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('accept_call', {
        toUserId: fromUserId,
        signalData: answer
    });

    document.getElementById('call-modal').classList.remove('hidden');
}

// কল চলাকালীন টাইমার হ্যান্ডলার (১০ মিনিট = ৬০০ সেকেন্ড লজিক মনিটরিং)
function startCallTimer() {
    callSecondsElapsed = 0;
    clearInterval(callDurationInterval);
    
    callDurationInterval = setInterval(() => {
        callSecondsElapsed++;
        const mins = String(Math.floor(callSecondsElapsed / 60)).padStart(2, '0');
        const secs = String(callSecondsElapsed % 60).padStart(2, '0');
        document.getElementById('call-duration-timer').innerText = `${mins}:${secs}`;

        const badge = document.getElementById('call-rule-badge');
        if (callSecondsElapsed >= 600) {
            badge.style.background = '#2ecc71';
            badge.innerText = '১০ মিনিট পূর্ণ! পয়েন্ট যোগ হবে';
        } else {
            const remaining = 600 - callSecondsElapsed;
            badge.style.background = 'rgba(231, 76, 60, 0.8)';
            badge.innerText = `পয়েন্ট পেতে বাকি: ${Math.floor(remaining / 60)}মিনিট ${remaining % 60}সেকেন্ড`;
        }
    }, 1000);
}

// কল শেষ করা
function endCurrentCall() {
    if (currentActiveCallId) {
        socket.emit('end_call', { callId: currentActiveCallId });
    }
    cleanUpCallMedia();
}

function cleanUpCallMedia() {
    clearInterval(callDurationInterval);
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('local-video').srcObject = null;
    document.getElementById('call-modal').classList.add('hidden');
    currentActiveCallId = null;
    activeTargetUserId = null;
}

// অডিও ও ভিডিও টগল
function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            document.getElementById('mic-icon').style.stroke = audioTrack.enabled ? '#fff' : '#e74c3c';
        }
    }
}

function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            document.getElementById('cam-icon').style.stroke = videoTrack.enabled ? '#fff' : '#e74c3c';
        }
    }
                                                                      }
