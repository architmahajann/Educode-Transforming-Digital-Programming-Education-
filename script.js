// Make socket global so admin activity listeners can attach
window.socket = null;
let changeEvent = false; // Initialize to false so user changes are tracked
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
// Determine if current class is a test (requires proctoring)
// room.ejs defines `testTimeLimit` (minutes) for tests; practice has 0/undefined
const IS_TEST_MODE = (typeof testTimeLimit !== 'undefined' && Number(testTimeLimit) > 0);

try {
    window.socket = io({
        reconnection: true,
        reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
        timeout: 10000
    });
    // Also keep local reference for backwards compatibility
    var socket = window.socket;
} catch (error) {
    console.error('Failed to initialize socket:', error);
    tata.error('Connection Error', 'Failed to initialize socket connection', {
        animate: 'fade',
        position: 'tm'
    });
}

// Socket error handling
socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    reconnectAttempts++;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        tata.error('Connection Failed', 'Unable to connect to server after multiple attempts', {
            animate: 'fade',
            position: 'tm'
        });
    }
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    tata.warn('Connection Lost', 'Attempting to reconnect...', {
        animate: 'fade',
        position: 'tm'
    });
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
    tata.success('Reconnected', 'Connection restored', {
        animate: 'fade',
        position: 'tm'
    });
    reconnectAttempts = 0;
});

// Editor Setup
const textinput = document.getElementById('code');

let mode;

// Determine editor mode based on language
if (typeof languageid !== 'undefined' && languageid) {
    try {
        const lang = JSON.parse(languageid);
        if (lang === 71) { // Python
            mode = 'python';
        } else if (lang === 62) { // Java
            mode = 'text/x-java';
        } else if (lang === 54 || lang === 49) { // C++ or C
            mode = 'text/x-c++src';
        } else {
            mode = 'text/x-c++src'; // Default
        }
    } catch (e) {
        console.error('Error parsing language:', e);
        mode = 'text/x-c++src';
    }
} else {
    mode = 'text/x-c++src';
}

// Initialize CodeMirror editor
const editor = CodeMirror.fromTextArea(textinput, {
    mode: mode,
    theme: 'dracula',
    lineNumbers: true,
    autoCloseBrackets: true,
    matchBrackets: true,
    indentUnit: 4,
    indentWithTabs: true,
    lineWrapping: true,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter']
});

editor.setSize('100%', '100%');


// Handle changes from admin side
socket.on('adminsidedata', function (user, changeObj) {
  try {
    console.log('Received admin changes for:', user, 'Current user:', username);
    
    if (!editor || !changeObj) {
      console.error('Invalid editor or change object');
      return;
    }
    
    // Only apply changes if they're for this user
    if (username === user) {
      console.log('Applying admin changes to student editor');
      
      // Show teaching activity and notification
      if (typeof addAdminActivity === 'function') {
        addAdminActivity('✍️ Admin is making changes to your code', 'admin-teaching');
      }
      if (typeof setEditorVisualFeedback === 'function') {
        setEditorVisualFeedback(true, true);
      }
      
      // Show one-time notification
      if (!window.adminTeachingNotified) {
        if (typeof showAdminNotification === 'function') {
          showAdminNotification('Teaching Mode', 'Admin is editing your code', 'warn');
        }
        window.adminTeachingNotified = true;
        
        // Reset notification flag after 5 seconds
        setTimeout(() => {
          window.adminTeachingNotified = false;
        }, 5000);
      }
      
      // Temporarily set changeEvent to true to prevent echo
      changeEvent = true;
      
      if (!Array.isArray(changeObj.text)) {
        console.error('Invalid change object text:', changeObj);
        return;
      }
      
      editor.replaceRange(
        changeObj.text,
        changeObj.from,
        changeObj.to,
        'admin-change' // Use different origin to distinguish from user changes
      );
      
      // Reset changeEvent after a short delay
      setTimeout(() => {
        changeEvent = false;
        // Reset visual feedback after teaching stops
        if (typeof setEditorVisualFeedback === 'function') {
          setEditorVisualFeedback(true, false);
        }
      }, 2000);
    }
  } catch (error) {
    console.error('Error applying admin changes:', error);
    tata.error('Error', 'Failed to apply admin changes', {
      animate: 'fade',
      position: 'tm'
    });
  }
});

// Track editor focus state
editor.on('blur', () => {
  changeEvent = true;
  
  // Save code to database when user blurs the editor
  try {
    const code = editor.getValue();
    socket.emit('save-code', username, code);
    console.log('Saved code to database');
  } catch (error) {
    console.error('Error saving code on blur:', error);
  }
});

// Periodically save code every 30 seconds
setInterval(() => {
  try {
    const code = editor.getValue();
    if (code && username) {
      socket.emit('save-code', username, code);
      console.log('Auto-saved code to database');
    }
  } catch (error) {
    console.error('Error auto-saving code:', error);
  }
}, 30000); // Save every 30 seconds

// Save code before page unload
window.addEventListener('beforeunload', () => {
  try {
    const code = editor.getValue();
    if (code && username) {
      socket.emit('save-code', username, code);
    }
  } catch (error) {
    console.error('Error saving code before unload:', error);
  }
});
socket.on('delete-roomadmin', function (roomId) {
  try {
    const urlParts = new URL(window.location.href);
    const pathParts = urlParts.pathname.split('/');
    const currentRoomId = pathParts[pathParts.indexOf('joined') + 1];
    
    if (currentRoomId === roomId) {
      tata.warn('Room', 'Room has been deleted by admin', {
        animate: 'fade',
        position: 'tm',
      });
      // Use setTimeout instead of setInterval for one-time execution
      setTimeout(() => {
        window.location.replace('/');
      }, 3000);
    }
  } catch (error) {
    console.error('Error handling room deletion:', error);
    tata.error('Error', 'Failed to process room deletion', {
      animate: 'fade',
      position: 'tm'
    });
  }
});

// Send IDE data to admin
socket.on('personal-ide', function (name) {
  try {
    if (!editor) {
      console.error('Editor not initialized');
      return;
    }
    
    const code = editor.getValue();
    if (code === undefined) {
      console.error('Failed to get editor content');
      return;
    }
    
    socket.emit('getidedata', code, username);
  } catch (error) {
    console.error('Error sending IDE data:', error);
    tata.error('Error', 'Failed to send code to admin', {
      animate: 'fade',
      position: 'tm'
    });
  }
});

// Handle user changes
editor.on('focus', () => {
  changeEvent = false;
});

editor.on('change', (editor, changeData) => {
  try {
    if (changeEvent === false && socket && socket.connected) {
      // Validate change data
      if (!changeData || !changeData.from || !changeData.to || !changeData.text) {
        console.error('Invalid change data:', changeData);
        return;
      }
      
      socket.emit('userdochange', changeData, username);
    }
  } catch (error) {
    console.error('Error handling editor change:', error);
    tata.error('Error', 'Failed to sync changes', {
      animate: 'fade',
      position: 'tm'
    });
  }
});

let currentRoomId = null;

socket.on('connect', function () {
  try {
    console.log('Student socket connected');
    const urlParts = new URL(window.location.href);
    const pathParts = urlParts.pathname.split('/');
    const roomId = pathParts[pathParts.indexOf('joined') + 1];
    
    if (!roomId) {
      console.error('Could not determine room ID from URL');
      tata.error('Connection Error', 'Invalid room ID', {
        animate: 'fade',
        position: 'tm'
      });
      return;
    }
    
    // Store current room ID for reconnection
    currentRoomId = roomId;
    
    console.log('Joining room:', roomId, 'as user:', username);
    
    // Join room
    socket.emit('createroom', roomId, username);
    
    tata.success('Connected', 'Successfully joined the room', {
      animate: 'fade',
      position: 'tm'
    });
  } catch (error) {
    console.error('Error joining room:', error);
    tata.error('Connection Error', 'Failed to join room', {
      animate: 'fade',
      position: 'tm'
    });
  }
});

document.getElementById('submitcode').addEventListener('click', () => {
  console.log('code Submitted');
  const urlParts = new URL(window.location.href);
  const pathParts = urlParts.pathname.split('/');
  const roomId = pathParts[pathParts.indexOf('joined') + 1];
  
  if (!roomId) {
    tata.error('Submit', 'Could not determine room ID', {
      animate: 'fade',
      position: 'tm'
    });
    return;
  }

  const code = editor.getValue();
  if (!code.trim()) {
    tata.error('Submit', 'Code cannot be empty', {
      animate: 'fade',
      position: 'tm'
    });
    return;
  }

  axios
    .post('/api/v1/submitcode', {
      code,
      id: roomId,
      username,
    })
    .then((res) => {
      tata.success('Submit', 'Your Code is Submitted successfully!', {
        animate: 'fade',
        position: 'tm',
      });
      setTimeout(() => {
        window.location.replace('/');
      }, 3000);
    })
    .catch((err) => {
      tata.error('Submit', 'Oops! Some Error Occurred', {
        animate: 'fade',
        position: 'tm',
      });
    });
});

// --- WebRTC Video Sharing Logic (Student Side) ---

const btnShareCamera = document.getElementById('btnShareCamera');
const btnStopCamera = document.getElementById('btnStopCamera');
const studentPreview = document.getElementById('studentPreview');
const studentAVStatus = document.getElementById('studentAVStatus');

let localStream;
let peerConnection;
// === Periodic Snapshot (Proctoring) ===
// === Strict 20s Snapshot Loop (Proctoring) ===
let snapshotIntervalId = null;
const SNAPSHOT_INTERVAL_MS = 20000; // EXACT 20 seconds cadence
let videoReadyForSnapshots = false;
let lastSnapshotMeta = { attempted: null, uploaded: null, brightness: null, skipped: false };
function markVideoReady(){
  if (studentPreview && studentPreview.videoWidth > 0 && studentPreview.videoHeight > 0) {
    videoReadyForSnapshots = true;
  }
}
studentPreview && studentPreview.addEventListener('loadeddata', markVideoReady);
studentPreview && studentPreview.addEventListener('playing', markVideoReady);

function startSnapshotLoop(){
  if (!IS_TEST_MODE) { return; }
  if (snapshotIntervalId || !studentPreview) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const brightnessOk = () => {
    try {
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return false;
      const data = ctx.getImageData(0,0,w,h).data;
      let sum = 0, samples = 0;
      // sample every 40th pixel to reduce cost
      for (let i=0; i<data.length; i+=160) { // 160 = 40px * 4 channels
        sum += (data[i] + data[i+1] + data[i+2]) / 3; samples++;
      }
      const avg = sum / samples; // 0..255
      return avg > 10; // >10 brightness threshold
    } catch(_) { return true; }
  };

  async function captureSnapshot(){
    // diagnostic heartbeat for attempts
    try { console.log('[Student] Snapshot attempt @', new Date().toISOString()); } catch(_) {}
    if (!studentPreview.srcObject) { console.debug('[Student] Skip snapshot (no stream)'); return; }
    if (!videoReadyForSnapshots) { markVideoReady(); if (!videoReadyForSnapshots) { console.debug('[Student] Video not ready yet'); return; } }
    const vw = studentPreview.videoWidth, vh = studentPreview.videoHeight;
    if (!vw || !vh) { console.debug('[Student] Dimensions zero, skipping'); return; }
    // Reduced resolution to lower payload size
    const targetW = 240; const targetH = Math.round(vh * (targetW / vw));
    canvas.width = targetW; canvas.height = targetH;
    // Ensure latest frame
    if (studentPreview.requestVideoFrameCallback) {
      await new Promise(r => { try { studentPreview.requestVideoFrameCallback(()=>r()); } catch(_) { r(); } });
    }
    try { ctx.drawImage(studentPreview,0,0,targetW,targetH); } catch(e){ console.warn('[Student] drawImage failed first attempt', e); return; }
    // Retry up to 2 times if dark
    let attempts = 0;
    while (!brightnessOk() && attempts < 2){
      attempts++;
      await new Promise(r => setTimeout(r, 250));
      try { ctx.drawImage(studentPreview,0,0,targetW,targetH); } catch(_) {}
    }
    if (!brightnessOk()) {
      // Fallback using ImageCapture for potentially better frame
      try {
        const track = studentPreview.srcObject.getVideoTracks()[0];
        if (track && typeof ImageCapture === 'function') {
          const ic = new ImageCapture(track);
          const bmp = await ic.grabFrame();
          canvas.width = 320;
          canvas.height = Math.round(bmp.height * (320 / bmp.width));
          ctx.drawImage(bmp,0,0,canvas.width,canvas.height);
        }
      } catch(e){ console.debug('[Student] ImageCapture fallback failed', e.message); }
    }
    const avgBrightnessDebug = (() => { try { const d = ctx.getImageData(0,0,canvas.width,canvas.height).data; let s=0,c=0; for(let i=0;i<d.length;i+=160){ s+=(d[i]+d[i+1]+d[i+2])/3;c++; } return (s/c).toFixed(1); } catch(_) { return 'n/a'; } })();
    if (!brightnessOk()) { console.warn('[Student] Snapshot still dark (avg '+avgBrightnessDebug+'), uploading anyway for diagnostics'); }
    // Further compression (quality 0.5) to stay below body limit
    const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
    fetch('/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userid: username, image: dataUrl })
    }).catch(err => console.warn('[Student] Snapshot upload failed', err));
    lastSnapshotMeta = { attempted: new Date().toISOString(), uploaded: new Date().toISOString(), brightness: avgBrightnessDebug, skipped: false };
    updateSnapshotDiag();
    console.log('[Student] Snapshot uploaded (brightness avg '+avgBrightnessDebug+')');
  }

  // Strict cadence using setInterval (does not drift with capture time)
  snapshotIntervalId = setInterval(captureSnapshot, SNAPSHOT_INTERVAL_MS);
  // Prime first snapshot slightly later to ensure camera warms up
  setTimeout(captureSnapshot, 3000);
  console.log('[Student] Started strict 20s snapshot loop');
  createSnapshotDiag();
}
function stopSnapshotLoop(){
  if (snapshotIntervalId){ clearInterval(snapshotIntervalId); snapshotIntervalId = null; }
  videoReadyForSnapshots = false;
  console.log('[Student] Stopped snapshot loop');
  destroySnapshotDiag();
}
// Watchdog to ensure snapshots keep running during tests when camera is live
if (IS_TEST_MODE) {
  setInterval(() => {
    try {
      const hasStream = !!(studentPreview && studentPreview.srcObject);
      if (hasStream && !snapshotIntervalId) {
        console.warn('[Student] Watchdog: camera live but snapshot loop not running; starting...');
        startSnapshotLoop();
        return;
      }
      // Restart if no upload in >35s while loop is active
      if (snapshotIntervalId && lastSnapshotMeta && lastSnapshotMeta.uploaded) {
        const last = new Date(lastSnapshotMeta.uploaded).getTime();
        if ((Date.now() - last) > 35000) {
          console.warn('[Student] Watchdog: no snapshot upload in 35s, restarting loop');
          stopSnapshotLoop();
          startSnapshotLoop();
        }
      }
    } catch(_) {}
  }, 10000);
}
// === End Strict Snapshot Loop ===

// === Snapshot Diagnostics Overlay ===
let snapshotDiagEl = null;
function createSnapshotDiag(){
  if (snapshotDiagEl) return;
  snapshotDiagEl = document.createElement('div');
  snapshotDiagEl.style.cssText = 'position:fixed;right:12px;bottom:12px;background:#101822;color:#e6f1ff;font-size:11px;padding:8px 10px;border:1px solid #204063;border-radius:8px;z-index:2100;box-shadow:0 4px 12px rgba(0,0,0,0.4);max-width:240px;line-height:1.4;font-family:system-ui,Arial,sans-serif;';
  snapshotDiagEl.innerHTML = '<strong style="display:block;margin-bottom:4px;font-size:12px;color:#7db3ff;">Snapshot Status</strong><div id="snapshotDiagBody">Initializing…</div>';
  document.body.appendChild(snapshotDiagEl);
  updateSnapshotDiag();
}
function updateSnapshotDiag(){
  const body = snapshotDiagEl && snapshotDiagEl.querySelector('#snapshotDiagBody');
  if (!body) return;
  body.innerHTML = `
    <div><span style="color:#93c5fd">Ready:</span> ${videoReadyForSnapshots ? 'yes' : 'no'}</div>
    <div><span style="color:#93c5fd">Last Attempt:</span> ${lastSnapshotMeta.attempted || '—'}</div>
    <div><span style="color:#93c5fd">Last Upload:</span> ${lastSnapshotMeta.uploaded || '—'}</div>
    <div><span style="color:#93c5fd">Brightness:</span> ${lastSnapshotMeta.brightness || '—'}</div>
  `;
}
function destroySnapshotDiag(){
  if (snapshotDiagEl && snapshotDiagEl.parentNode) snapshotDiagEl.parentNode.removeChild(snapshotDiagEl);
  snapshotDiagEl = null;
}
// === End Periodic Snapshot ===
const config = (() => {
  try {
    const raw = window.WEBRTC_ICE_SERVERS;
    const forceRelay = !!window.WEBRTC_FORCE_TURN;
    if (Array.isArray(raw) && raw.length) {
      return {
        iceServers: raw.map(entry => {
          if (Array.isArray(entry.urls)) return { urls: entry.urls };
          if (typeof entry.urls === 'string') return { urls: entry.urls };
          return entry;
        }),
        iceTransportPolicy: forceRelay ? 'relay' : undefined
      };
    }
  } catch(e) { console.warn('[Student] ICE server parse failed', e); }
  return { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], iceTransportPolicy: (window.WEBRTC_FORCE_TURN ? 'relay' : undefined) };
})();

async function startCameraSharing(trigger='manual') {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    studentPreview.srcObject = localStream;
    try { await studentPreview.play(); } catch(_) {}
    studentPreview.style.display = 'block';
    btnShareCamera.style.display = 'none';
    btnStopCamera.style.display = 'inline-block';
    studentAVStatus.textContent = 'Sharing...';
    studentAVStatus.style.color = '#28a745';
    console.log('[Student] Emitting student-wants-to-share', { studentId: username, roomId: currentRoomId, trigger });
    socket.emit('student-wants-to-share', { studentId: username, roomId: currentRoomId });
    if (IS_TEST_MODE) startSnapshotLoop();
    // Log track details for diagnostics
    localStream.getTracks().forEach(t => {
      console.log('[Student] Local track ready', { kind: t.kind, id: t.id, enabled: t.enabled });
    });
  } catch (error) {
    console.error('Error accessing media devices.', error);
    tata.error('Camera Error', 'Could not access your camera. Please check permissions.', { position: 'tm' });
    // If this was in response to admin request, send denial
    if (trigger === 'admin-request') {
      socket.emit('student-camera-response', { studentId: username, accepted: false });
    }
  }
}

// Student manual share button
btnShareCamera.addEventListener('click', () => startCameraSharing('manual'));

// Listen for admin camera request
socket.on('admin-camera-request', ({ fromAdmin, target }) => {
  if (target && target !== username) return; // Ignore broadcast not for this student
  console.log('[Student] Received admin-camera-request from', fromAdmin, 'target:', target);
  const modal = document.getElementById('adminCamRequestModal');
  const text = document.getElementById('adminCamRequestText');
  const btnAccept = document.getElementById('adminCamAccept');
  const btnDecline = document.getElementById('adminCamDecline');
  if (!modal || !btnAccept || !btnDecline) {
    console.warn('[Student] Modal elements missing, falling back to confirm()');
    const accept = window.confirm(`Admin (${fromAdmin}) requests to enable your camera. Allow?`);
    if (accept) {
      socket.emit('student-camera-response', { studentId: username, accepted: true });
      startCameraSharing('admin-request');
    } else {
      socket.emit('student-camera-response', { studentId: username, accepted: false });
      tata.info('Camera Request', 'You declined admin request', { position: 'tm' });
    }
    return;
  }
  text.textContent = `Admin (${fromAdmin}) is requesting to view your camera. You can allow or decline.`;
  modal.style.display = 'flex';
  const cleanup = () => { modal.style.display = 'none'; };
  btnAccept.onclick = () => {
    socket.emit('student-camera-response', { studentId: username, accepted: true });
    startCameraSharing('admin-request');
    cleanup();
  };
  btnDecline.onclick = () => {
    socket.emit('student-camera-response', { studentId: username, accepted: false });
    tata.info('Camera Request', 'You declined admin request', { position: 'tm' });
    cleanup();
  };
});

// 2. Server tells this student to initiate connection with admin
socket.on('start-webrtc-connection', async ({
  adminSocketId
}) => {
  console.log(`Admin (${adminSocketId}) connected, starting WebRTC`);
  if (!localStream) {
    console.warn("Local stream not ready; attempting to start camera automatically");
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      studentPreview.srcObject = localStream;
      studentPreview.style.display = 'block';
      btnShareCamera.style.display = 'none';
      btnStopCamera.style.display = 'inline-block';
      studentAVStatus.textContent = 'Sharing...';
      studentAVStatus.style.color = '#28a745';
      socket.emit('student-wants-to-share', { studentId: username, roomId: currentRoomId });
      console.log('[Student] Auto-started camera on watch request');
      try { await studentPreview.play(); } catch(_) {}
      if (IS_TEST_MODE) startSnapshotLoop();
    } catch (e) {
      console.error('Camera permission denied or failed', e);
      try { tata.error('Camera', 'Please allow camera to let admin watch', { position: 'tm' }); } catch(_){ }
      return;
    }
  }

  // Create Peer Connection
  peerConnection = new RTCPeerConnection(config);
  // Simple diagnostics panel (student)
  (function ensureDiag(){
    if (document.getElementById('webrtcDiagStudent')) return;
    const el = document.createElement('div');
    el.id = 'webrtcDiagStudent';
    el.style.cssText = 'position:fixed;right:12px;bottom:56px;background:#0b1220;color:#e6f1ff;border:1px solid #1f3b6d;padding:8px 10px;border-radius:8px;font-size:11px;z-index:2005;box-shadow:0 4px 14px rgba(0,0,0,0.25);max-width:280px;';
    el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><strong>WebRTC (Student)</strong><button id="webrtcDiagStudentClose" style="background:#14213d;color:#e6f1ff;border:1px solid #294a86;border-radius:6px;padding:2px 6px;cursor:pointer;font-size:11px;">Hide</button></div><div id="webrtcDiagStudentBody" style="line-height:1.35"></div>';
    document.body.appendChild(el);
    const btn = document.getElementById('webrtcDiagStudentClose');
    btn && btn.addEventListener('click', ()=>{ el.style.display='none'; });
    const upd = () => {
      const body = document.getElementById('webrtcDiagStudentBody');
      if (!body) return;
      body.innerHTML = `
        <div><span style="color:#93c5fd">Signaling:</span> ${peerConnection?.signalingState || '-'}</div>
        <div><span style="color:#93c5fd">ICE Conn:</span> ${peerConnection?.iceConnectionState || '-'}</div>
        <div><span style="color:#93c5fd">ICE Gather:</span> ${peerConnection?.iceGatheringState || '-'}</div>
        <div><span style="color:#93c5fd">Conn:</span> ${peerConnection?.connectionState || '-'}</div>
      `;
    };
    // initial render
    upd();
    // hook updates
    const oldConn = peerConnection.onconnectionstatechange;
    peerConnection.onconnectionstatechange = (...a)=>{ try{upd();}catch(_){}; oldConn && oldConn.apply(peerConnection,a); };
    const oldIce = peerConnection.oniceconnectionstatechange;
    peerConnection.oniceconnectionstatechange = (...a)=>{ try{upd();}catch(_){}; oldIce && oldIce.apply(peerConnection,a); };
    const oldGather = peerConnection.onicegatheringstatechange;
    peerConnection.onicegatheringstatechange = (...a)=>{ try{upd();}catch(_){}; oldGather && oldGather.apply(peerConnection,a); };
  })();

    peerConnection.onconnectionstatechange = () => {
      console.log('[Student] connectionstatechange =>', peerConnection.connectionState);
    };
    peerConnection.oniceconnectionstatechange = () => {
      console.log('[Student] iceConnectionState =>', peerConnection.iceConnectionState);
    };
    peerConnection.onicegatheringstatechange = () => {
      console.log('[Student] iceGatheringState =>', peerConnection.iceGatheringState);
    };

    // Add local stream tracks to the connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      console.log('[Student] Added track to PC', { kind: track.kind, id: track.id });
    });

    // Receive admin remote tracks (for two-way chat)
    peerConnection.ontrack = (ev) => {
      console.log('[Student] ontrack received from admin', ev.track && ev.track.kind);
      const adminChatVideo = document.getElementById('adminRemoteChat');
      if (adminChatVideo && ev.streams && ev.streams[0]) {
        if (!adminChatVideo.srcObject) {
          adminChatVideo.srcObject = ev.streams[0];
          adminChatVideo.style.display = 'block';
          adminChatVideo.muted = false; // allow hearing admin (student side)
          adminChatVideo.play().catch(err => console.warn('[Student] adminChatVideo play() failed', err));
          const statusEl = document.getElementById('adminChatStatus');
          if (statusEl) { statusEl.textContent = 'Live ●'; statusEl.style.color = '#28a745'; statusEl.style.fontWeight = 'bold'; }
        }
      }
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        console.log('[Student] Sending ICE candidate to admin');
        socket.emit('webrtc-ice-candidate', {
          targetSocketId: adminSocketId,
          candidate: event.candidate,
        });
      } else {
        console.log('[Student] ICE gathering complete');
      }
    };

    // Create offer and send to admin
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log('[Student] Created offer, signalingState:', peerConnection.signalingState);
    console.log('[Student] Offer SDP size:', offer.sdp && offer.sdp.length);

    console.log('[Student] Sending WebRTC offer to admin');
    socket.emit('webrtc-offer', {
      targetSocketId: adminSocketId,
      sdp: offer
    });
});


// 5. Receive answer from admin
socket.on('webrtc-answer', async ({
    sdp
}) => {
    if (peerConnection && peerConnection.signalingState !== 'stable') {
        console.log('Received WebRTC answer from admin');
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
            studentAVStatus.textContent = 'Live';
            studentAVStatus.style.color = 'red';
      console.log('[Student] Remote description set. Connection state:', peerConnection.connectionState);
      setTimeout(() => {
        console.log('[Student] Post-answer state:', {
          signalingState: peerConnection.signalingState,
          connectionState: peerConnection.connectionState,
          iceConnectionState: peerConnection.iceConnectionState
        });
        if (peerConnection.connectionState !== 'connected') {
          console.warn('[Student] Not connected after answer; tracks:', localStream.getTracks().map(t=>({kind:t.kind, id:t.id, readyState:t.readyState})));
        }
      }, 2000);
        } catch (error) {
            console.error("Error setting remote description:", error);
        }
    }
});

// 6. Receive ICE candidates from admin
socket.on('webrtc-ice-candidate', async ({
    candidate
}) => {
    if (peerConnection) {
        try {
      console.log('[Student] Received ICE candidate from admin');
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Error adding received ice candidate', e);
        }
    }
});


// Stop sharing
btnStopCamera.addEventListener('click', () => {
    stopSharing();
    socket.emit('student-stopped-sharing', {
        studentId: username
    });
});

socket.on('admin-closed-connection', () => {
    console.log("Admin closed the video connection.");
    tata.info('Video Off', 'Admin has stopped viewing your camera.', {
        position: 'tm'
    });
    stopSharing();
});


function stopSharing() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
  stopSnapshotLoop();
    // hide diagnostics panel on stop
    const diag = document.getElementById('webrtcDiagStudent');
    if (diag && diag.parentNode) diag.parentNode.removeChild(diag);

    studentPreview.srcObject = null;
    studentPreview.style.display = 'none';
    btnShareCamera.style.display = 'inline-block';
    btnStopCamera.style.display = 'none';
    studentAVStatus.textContent = 'Not sharing';
    studentAVStatus.style.color = '#888';
    console.log('Camera sharing stopped.');
    // Hide admin chat video if present (ends chat session visuals)
    const adminChatVideo = document.getElementById('adminRemoteChat');
    const adminChatStatus = document.getElementById('adminChatStatus');
    if (adminChatVideo){ adminChatVideo.srcObject = null; adminChatVideo.style.display='none'; }
    if (adminChatStatus){ adminChatStatus.textContent='Idle'; adminChatStatus.style.color='#888'; adminChatStatus.style.fontWeight='normal'; }
}
  // Diagnostic listener for potential server errors
  socket.on('student-video-error', (msg) => {
    console.error('[Student] Video error from server:', msg);
    tata.error('Video Share Error', msg, { position: 'tm' });
  });
// --- End WebRTC Logic ---

// ===== Class Chat (Student Side) =====
(() => {
  const socket = window.socket;
  if (!socket) return;
  const msgsEl = document.getElementById('classChatMessages');
  const inputEl = document.getElementById('classChatInput');
  const sendBtn = document.getElementById('classChatSend');
  const refreshBtn = document.getElementById('classChatRefresh');
  let roomId = null;
  try {
    const urlParts = new URL(window.location.href);
    const pathParts = urlParts.pathname.split('/');
    roomId = pathParts[pathParts.indexOf('joined') + 1];
  } catch(_) {}
  function esc(str){ return String(str).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function render(messages){
    if (!msgsEl) return;
    if (!messages || !messages.length){ msgsEl.innerHTML='<div style="color:#888; font-style:italic; text-align:center; margin-top:16px;">No messages yet</div>'; return; }
    const parts=[];
    messages.forEach(m => {
      const date = new Date(m.ts || Date.now());
      const time = date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      parts.push('<div style="margin-bottom:5px;">');
      parts.push('<span style="color:#0d6efd; font-weight:600;">'+esc(m.sender)+':</span> ');
      parts.push('<span style="color:#222;">'+esc(m.text)+'</span> ');
      parts.push('<span style="color:#999; font-size:10px;">['+time+']</span>');
      parts.push('</div>');
    });
    msgsEl.innerHTML = parts.join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  socket.on('class-chat-init', ({ messages }) => render(messages));
  socket.on('class-chat-new', (msg) => {
    if (!msgsEl) return;
    const placeholder = msgsEl.querySelector('div[style*="italic"]');
    if (placeholder) placeholder.remove();
    const date = new Date(msg.ts || Date.now());
    const time = date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const line = document.createElement('div');
    line.style.marginBottom='5px';
    line.innerHTML = '<span style="color:#0d6efd; font-weight:600;">'+esc(msg.sender)+':</span> <span style="color:#222;">'+esc(msg.text)+'</span> <span style="color:#999; font-size:10px;">['+time+']</span>';
    msgsEl.appendChild(line);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  });
  sendBtn && sendBtn.addEventListener('click', () => {
    const v = inputEl.value.trim();
    if (!v) return;
    socket.emit('class-chat-send', { roomId, text: v });
    inputEl.value='';
  });
  inputEl && inputEl.addEventListener('keydown', e => { if (e.key==='Enter'){ sendBtn.click(); } });
  refreshBtn && refreshBtn.addEventListener('click', () => { socket.emit('class-chat-history', { roomId }); });
})();
// ===================================
