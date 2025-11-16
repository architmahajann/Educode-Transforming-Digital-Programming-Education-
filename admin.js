// Clean, ordered initialization to avoid editor undefined errors
(function(){
  const socket = window.socket || io();
  window.socket = socket;
  const userlist = document.getElementById('userlist');
  const deleteroom = document.getElementById('deleteroom');
  const roomId = window.location.toString().split('admin/')[1]?.split('/')[0];
  let broadcastEnabled = false;
  let userCurrent = null;
  let isUserChnage = false;

  // ---- Editor Initialization ----
  let editor;
  try {
    const textinput = document.getElementById('code');
    if (!textinput) throw new Error('Missing #code textarea');
    let mode;
    if (languageid == 62) mode = 'text/x-java';
    else if (languageid == 54) mode = 'text/x-c++src';
    else if (languageid == 49) mode = 'text/x-csrc';
    else mode = 'text/x-python';
    editor = CodeMirror.fromTextArea(textinput, {
      lineNumbers: true,
      tabSize: 2,
      lineWrapping: true,
      indentUnit: 4,
      foldGutter: true,
      autoCloseBrackets: true,
      gutters: ['CodeMirror-linenumbers','CodeMirror-foldgutter'],
      matchBrackets: true,
      mode,
      theme: 'dracula'
    });
    if (languageid == 62) editor.setValue('public class Main {\n    public static void main(String[] args) {\n        //Your code goes here\n    }\n}\n');
    if (languageid == 54) editor.setValue('#include <iostream>\nusing namespace std;\nint main() {\n      // Your code goes here\n}\n');
    if (languageid == 49) editor.setValue('#include <stdio.h>\nint main() {\n    // Your code goes here\n    return 0;\n}\n');
    if (languageid == 71) editor.setValue('#Python(3.8.1)...\n#Your code goes here\n');
    editor.setSize('720px','630px');
    window.editor = editor; // expose for runcode.js
  } catch(e){
    console.error('Editor initialization failed:', e);
    try { tata.error('Editor','Editor is not initialized'); } catch(_) {}
  }

  // ---- WebRTC Student Viewing ----
  // Modal elements might not be in DOM yet (markup is after scripts). We'll query them on demand.
  let studentVideoModal = document.getElementById('studentVideoModal');
  let studentVideoStream = document.getElementById('studentVideoStream');
  let studentVideoTitle = document.getElementById('studentVideoTitle');
  let studentVideoStatus = document.getElementById('studentVideoStatus');
  let closeStudentVideo = document.getElementById('closeStudentVideo');
  let studentAudioUnmute = document.getElementById('studentAudioUnmute');
  // Keep a map of remote streams for optional pop-out to modal
  const remoteStreams = new Map(); // username -> MediaStream

  // Centralized modal close handler (works even if attached later)
  function closeStudentModal() {
    try {
      // Refresh references in case DOM added after script
      studentVideoModal = document.getElementById('studentVideoModal');
      studentVideoStream = document.getElementById('studentVideoStream');
      studentVideoTitle = document.getElementById('studentVideoTitle');
      const studentUsername = (studentVideoTitle && studentVideoTitle.textContent || '').replace('Live View: ', '');
      const pc = peerConnections[studentUsername];
      if (pc){ try{ pc.close(); }catch(_){} delete peerConnections[studentUsername]; }
      if (localChatStream){
        try { localChatStream.getTracks().forEach(t => t.stop()); } catch(_){ }
        localChatStream = null;
        const selfEl = document.getElementById('adminSelfPreviewChat');
        const selfStatus = document.getElementById('adminSelfPreviewStatus');
        if (selfEl){ selfEl.srcObject = null; selfEl.style.display='none'; }
        if (selfStatus){ selfStatus.textContent = 'Not capturing'; selfStatus.style.color='#666'; }
      }
      if (studentVideoStream) studentVideoStream.srcObject = null;
      if (studentVideoModal) studentVideoModal.style.display='none';
      try { destroyDiagPanelAdmin(); } catch(_){ }
      if (studentUsername) socket.emit('admin-closed-video',{ studentId: studentUsername });
      console.log('[Admin] Modal closed for', studentUsername);
    } catch(err){ console.warn('[Admin] Close modal failed', err); }
  }

  // Hide-only: closes the modal UI but keeps the stream/PC active
  function hideStudentModal() {
    try {
      studentVideoModal = document.getElementById('studentVideoModal');
      studentVideoStream = document.getElementById('studentVideoStream');
      if (studentVideoStream) studentVideoStream.srcObject = null; // detach element only
      if (studentVideoModal) studentVideoModal.style.display='none';
      console.log('[Admin] Modal hidden (stream kept)');
    } catch(err){ console.warn('[Admin] Hide modal failed', err); }
  }

  // Event delegation for close button (handles late-loaded DOM)
  document.addEventListener('click', (e) => {
    if (e.target && (e.target.id === 'closeStudentVideo')) {
      e.preventDefault();
      hideStudentModal();
    }
    if (e.target && (e.target.id === 'studentAudioUnmute')) {
      try {
        studentVideoStream = document.getElementById('studentVideoStream');
        studentAudioUnmute = document.getElementById('studentAudioUnmute');
        if (studentVideoStream){
          studentVideoStream.muted = false;
          studentVideoStream.play().catch(()=>{});
        }
        if (studentAudioUnmute) studentAudioUnmute.style.display = 'none';
      } catch(_) {}
    }
    // Click on overlay outside the dialog closes too
    if (e.target && e.target.id === 'studentVideoModal') {
      hideStudentModal();
    }
  });
  // ESC closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('studentVideoModal');
      if (modal && modal.style.display === 'block') hideStudentModal();
    }
  });
  // Simple WebRTC diagnostics panel (admin)
  let diagElAdmin = null;
  function createDiagPanelAdmin(student){
    if (diagElAdmin) return;
    diagElAdmin = document.createElement('div');
    diagElAdmin.id = 'webrtcDiagAdmin';
    diagElAdmin.style.cssText = 'position:fixed;left:12px;bottom:56px;background:#0b1220;color:#e6f1ff;border:1px solid #1f3b6d;padding:8px 10px;border-radius:8px;font-size:11px;z-index:2005;box-shadow:0 4px 14px rgba(0,0,0,0.25);max-width:280px;';
    diagElAdmin.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><strong>WebRTC (Admin)</strong><button id="webrtcDiagAdminClose" style="background:#14213d;color:#e6f1ff;border:1px solid #294a86;border-radius:6px;padding:2px 6px;cursor:pointer;font-size:11px;">Hide</button></div><div id="webrtcDiagAdminBody" style="line-height:1.35"></div>';
    document.body.appendChild(diagElAdmin);
    const btn = diagElAdmin.querySelector('#webrtcDiagAdminClose');
    btn && btn.addEventListener('click', ()=>{ diagElAdmin.style.display = 'none'; });
    updateDiagPanelAdmin({ student, signalingState: '-', iceConnectionState: '-', connectionState: '-', iceGatheringState: '-' });
  }
  function updateDiagPanelAdmin({ student, signalingState, iceConnectionState, connectionState, iceGatheringState }){
    const body = diagElAdmin && diagElAdmin.querySelector('#webrtcDiagAdminBody');
    if (!body) return;
    const s = (v)=> (typeof v === 'string' ? v : (v||'-'));
    if (student) {
      // update title line subtly
    }
    body.innerHTML = `
      <div><span style="color:#93c5fd">Student:</span> ${s(student || studentVideoTitle?.textContent?.replace('Live View: ','') || '')}</div>
      <div><span style="color:#93c5fd">Signaling:</span> ${s(signalingState)}</div>
      <div><span style="color:#93c5fd">ICE Conn:</span> ${s(iceConnectionState)}</div>
      <div><span style="color:#93c5fd">ICE Gather:</span> ${s(iceGatheringState)}</div>
      <div><span style="color:#93c5fd">Conn:</span> ${s(connectionState)}</div>
    `;
  }
  function destroyDiagPanelAdmin(){
    if (diagElAdmin && diagElAdmin.parentNode) diagElAdmin.parentNode.removeChild(diagElAdmin);
    diagElAdmin = null;
  }
  // Dynamic ICE servers (env-provided TURN support)
  const config = (() => {
    try {
      const raw = window.WEBRTC_ICE_SERVERS;
      const forceRelay = !!window.WEBRTC_FORCE_TURN;
      if (Array.isArray(raw) && raw.length) {
        return { iceServers: raw.map(entry => {
          if (Array.isArray(entry.urls)) return { urls: entry.urls };
          if (typeof entry.urls === 'string') return { urls: entry.urls };
          return entry;
        }), iceTransportPolicy: forceRelay ? 'relay' : undefined };
      }
    } catch(e) { console.warn('[Admin] ICE server parse failed', e); }
    return { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], iceTransportPolicy: (window.WEBRTC_FORCE_TURN ? 'relay' : undefined) };
  })();
  const peerConnections = {}; // username -> RTCPeerConnection
  let studentsSharing = new Set();

  socket.on('update-sharing-students', (sharingUsernames = []) => {
    studentsSharing = new Set(sharingUsernames);
    document.querySelectorAll('.stu-list.active-user').forEach(div => {
      const name = div.dataset.username;
      if (!name) return;
      let btn = div.querySelector('.watch-btn');
      let reqBtn = div.querySelector('.request-cam-btn');
      const sharing = studentsSharing.has(name);
      if (!btn){
        btn = document.createElement('button');
        btn.className = 'btn btn-sm watch-btn';
        btn.dataset.username = name;
        btn.style.marginLeft = '10px';
        div.appendChild(btn);
      }
      btn.textContent = sharing ? 'Watch' : 'Not Sharing';
      btn.disabled = !sharing;
      btn.style.backgroundColor = sharing ? '#28a745' : '#6c757d';
      btn.style.cursor = sharing ? 'pointer':'not-allowed';
      // Request camera button (shown when not sharing)
      if (!reqBtn){
        reqBtn = document.createElement('button');
        reqBtn.className = 'btn btn-sm request-cam-btn';
        reqBtn.dataset.username = name;
        reqBtn.style.marginLeft = '6px';
        reqBtn.style.backgroundColor = '#0d6efd';
        reqBtn.style.color = '#fff';
        reqBtn.style.padding = '2px 6px';
        reqBtn.style.fontSize = '10px';
        reqBtn.style.border = 'none';
        reqBtn.style.borderRadius = '4px';
        div.appendChild(reqBtn);
      }
      reqBtn.textContent = sharing ? 'Request Sent' : 'Request Camera';
      reqBtn.disabled = sharing; // disable if already sharing
      reqBtn.style.opacity = sharing ? '0.6' : '1';

      // Auto-watch fallback: if student is sharing and we have not yet created a peer connection, request video after a short delay
      if (sharing && !peerConnections[name]) {
        // Avoid spamming: schedule a one-time check
        setTimeout(() => {
          if (studentsSharing.has(name) && !peerConnections[name]) {
            console.log('[Admin] Auto-watch fallback requesting video for', name);
            socket.emit('admin-requests-video', { studentId: name });
          }
        }, 1200); // slight delay to allow initial offer path first
      }
    });
  });

  let localChatStream = null; // admin local stream for 1:1 chat

  async function openStudentVideo(studentUsername, skipRequest){
    // Refresh modal references in case markup loaded after this script
    studentVideoModal = document.getElementById('studentVideoModal');
    studentVideoStream = document.getElementById('studentVideoStream');
    studentVideoTitle = document.getElementById('studentVideoTitle');
    studentVideoStatus = document.getElementById('studentVideoStatus');
    closeStudentVideo = document.getElementById('closeStudentVideo');
    if (studentVideoTitle) studentVideoTitle.textContent = 'Live View: ' + studentUsername;
    // Do NOT auto-open the full-screen modal; keep inline tiles compact
    // if (studentVideoModal) studentVideoModal.style.display = 'block';
    if (studentVideoStatus) studentVideoStatus.textContent = 'Requesting stream...';
    try { tata.info('Watching', 'Stream will appear under "Live Student Streams"'); } catch(_) {}
    if (!skipRequest){
      console.log('[Admin] Requesting video for student:', studentUsername);
      socket.emit('admin-requests-video', { studentId: studentUsername });
      // Await one-time ack for routing
      socket.once('admin-requests-video-ack', ({ studentId, delivered, reason }) => {
        if (studentId !== studentUsername) return;
        console.log('[Admin] Watch ack', { studentId, delivered, reason });
        if (studentVideoStatus){
          if (!delivered) studentVideoStatus.textContent = 'Failed to reach student: ' + (reason || 'unknown');
          else studentVideoStatus.textContent = 'Negotiating...';
        }
      });
    } else {
      console.log('[Admin] Auto-opening video (offer already received) for', studentUsername);
      if (studentVideoStatus) studentVideoStatus.textContent = 'Negotiating...';
    }
    const pc = new RTCPeerConnection(config);
    peerConnections[studentUsername] = pc;
    // Create diagnostics panel and keep statuses updated
    try { createDiagPanelAdmin(studentUsername); } catch(_){ }
    // Acquire admin local media for two-way chat (camera + mic)
    try {
      localChatStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const selfEl = document.getElementById('adminSelfPreviewChat');
      const selfStatus = document.getElementById('adminSelfPreviewStatus');
      if (selfEl){
        selfEl.srcObject = localChatStream;
        selfEl.style.display = 'block';
      }
      if (selfStatus){ selfStatus.textContent = 'Live'; selfStatus.style.color = '#28a745'; }
      localChatStream.getTracks().forEach(track => {
        pc.addTrack(track, localChatStream);
        console.log('[Admin] Added local track to PC', { kind: track.kind, id: track.id });
      });
    } catch(err){
      console.warn('[Admin] Could not capture local media for chat', err);
    }
    // Ensure ability to receive student media (sendrecv if transceivers desired)
    // Removed explicit addTransceiver calls (addTrack already creates transceivers). Extra transceivers can break SDP mapping.
    pc.onicecandidate = ev => { if (ev.candidate) socket.emit('webrtc-ice-candidate-admin',{ studentId: studentUsername, candidate: ev.candidate }); };
    pc.ontrack = ev => {
      const remoteStream = ev.streams[0];
      console.log('[Admin] ontrack fired for', studentUsername, remoteStream, 'tracks:', remoteStream.getTracks().map(t=>({kind:t.kind,id:t.id,enabled:t.enabled})));
      // Save for optional pop-out
      remoteStreams.set(studentUsername, remoteStream);
      // Modal stream if elements exist
      if (studentVideoStream && studentVideoModal && studentVideoModal.style.display === 'block'){
        studentVideoStream.srcObject = remoteStream;
        studentVideoStream.muted = true; // ensure autoplay
        studentVideoStream.play().then(()=>{
          try { (studentAudioUnmute || document.getElementById('studentAudioUnmute'))?.style && ((studentAudioUnmute||=document.getElementById('studentAudioUnmute')).style.display='block'); } catch(_){}
        }).catch(err => { console.warn('[Admin] play() failed', err); try { (studentAudioUnmute || document.getElementById('studentAudioUnmute'))?.style && ((studentAudioUnmute||=document.getElementById('studentAudioUnmute')).style.display='block'); } catch(_){} });
      }
      if (studentVideoStatus) studentVideoStatus.textContent='Connected';

      // Inline video handling
      try {
        const grid = document.getElementById('inlineStudentVideoGrid');
        const emptyMsg = document.getElementById('inlineStudentVideoEmpty');
        if (grid) {
          if (emptyMsg) emptyMsg.style.display = 'none';
          let wrapper = document.getElementById('inline-video-wrapper-' + studentUsername);
          if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.id = 'inline-video-wrapper-' + studentUsername;
            wrapper.style.position = 'relative';
            wrapper.style.border = '1px solid #e0e0e0';
            wrapper.style.borderRadius = '6px';
            wrapper.style.background = '#000';
            wrapper.style.overflow = 'hidden';
            wrapper.style.padding = '0';
            const vid = document.createElement('video');
            vid.id = 'inline-video-' + studentUsername;
            vid.autoplay = true;
            vid.playsInline = true;
            vid.muted = true; // avoid audio feedback
            vid.style.width = '100%';
            vid.style.height = '120px';
            vid.style.objectFit = 'cover';
            // Header overlay
            const label = document.createElement('div');
            label.textContent = studentUsername;
            label.style.position = 'absolute';
            label.style.left = '6px';
            label.style.top = '6px';
            label.style.fontSize = '11px';
            label.style.padding = '2px 6px';
            label.style.background = 'rgba(13,110,253,0.75)';
            label.style.color = '#fff';
            label.style.borderRadius = '4px';
            label.style.pointerEvents = 'none';
            // Close button
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '&times;';
            closeBtn.style.position = 'absolute';
            closeBtn.style.right = '6px';
            closeBtn.style.top = '4px';
            closeBtn.style.background = 'rgba(0,0,0,0.55)';
            closeBtn.style.color = '#fff';
            closeBtn.style.border = 'none';
            closeBtn.style.borderRadius = '4px';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.width = '20px';
            closeBtn.style.height = '20px';
            closeBtn.style.lineHeight = '16px';
            closeBtn.style.fontSize = '16px';
            closeBtn.title = 'Close stream';
            closeBtn.addEventListener('click', () => {
              try {
                const pcClose = peerConnections[studentUsername];
                if (pcClose) { pcClose.close(); delete peerConnections[studentUsername]; }
                if (localChatStream) { localChatStream.getTracks().forEach(t=>t.stop()); localChatStream = null; }
                const modalOpen = studentVideoModal && studentVideoModal.style.display === 'block' && studentVideoTitle.textContent.endsWith(studentUsername);
                if (modalOpen) { studentVideoStream.srcObject = null; studentVideoModal.style.display='none'; }
                wrapper.remove();
                const remaining = grid.querySelectorAll('video').length;
                if (remaining === 0 && emptyMsg) emptyMsg.style.display = 'block';
                socket.emit('admin-closed-video',{ studentId: studentUsername });
              } catch(err){ console.warn('[Admin] Inline close failed', err); }
            });
            // Pop-out to modal button
            const popBtn = document.createElement('button');
            popBtn.textContent = '↗';
            popBtn.style.position = 'absolute';
            popBtn.style.right = '30px';
            popBtn.style.top = '4px';
            popBtn.style.background = 'rgba(0,0,0,0.55)';
            popBtn.style.color = '#fff';
            popBtn.style.border = 'none';
            popBtn.style.borderRadius = '4px';
            popBtn.style.cursor = 'pointer';
            popBtn.style.width = '20px';
            popBtn.style.height = '20px';
            popBtn.style.lineHeight = '16px';
            popBtn.style.fontSize = '14px';
            popBtn.title = 'Open in modal';
            popBtn.addEventListener('click', () => {
              try {
                studentVideoModal = document.getElementById('studentVideoModal');
                studentVideoStream = document.getElementById('studentVideoStream');
                studentVideoTitle = document.getElementById('studentVideoTitle');
                if (studentVideoTitle) studentVideoTitle.textContent = 'Live View: ' + studentUsername;
                if (studentVideoModal) studentVideoModal.style.display = 'block';
                const rs = remoteStreams.get(studentUsername);
                if (studentVideoStream && rs){
                  studentVideoStream.srcObject = rs;
                  studentVideoStream.muted = true;
                  studentVideoStream.play().then(()=>{ try { (studentAudioUnmute||document.getElementById('studentAudioUnmute'))?.style && ((studentAudioUnmute||=document.getElementById('studentAudioUnmute')).style.display='block'); } catch(_){} }).catch(()=>{ try { (studentAudioUnmute||document.getElementById('studentAudioUnmute'))?.style && ((studentAudioUnmute||=document.getElementById('studentAudioUnmute')).style.display='block'); } catch(_){} });
                }
              } catch(_) {}
            });
            wrapper.appendChild(vid);
            wrapper.appendChild(label);
            wrapper.appendChild(closeBtn);
            wrapper.appendChild(popBtn);
            grid.appendChild(wrapper);
          }
          const inlineVideo = document.getElementById('inline-video-' + studentUsername);
          if (inlineVideo) {
            inlineVideo.srcObject = remoteStream;
            inlineVideo.play().catch(err => console.warn('[Admin] inline video play failed', err));
          }
        }
      } catch (e) {
        console.warn('[Admin] Inline video setup failed', e);
      }
    };
    pc.onconnectionstatechange = () => {
      console.log('[Admin] connectionstatechange', studentUsername, pc.connectionState);
      try { updateDiagPanelAdmin({ student: studentUsername, signalingState: pc.signalingState, iceConnectionState: pc.iceConnectionState, connectionState: pc.connectionState, iceGatheringState: pc.iceGatheringState }); } catch(_){ }
      if (pc.connectionState === 'connected') {
        studentVideoStatus.textContent='Live';
      } else if (['failed','disconnected','closed'].includes(pc.connectionState)) {
        console.warn('[Admin] Connection state ended:', pc.connectionState, 'closing modal for', studentUsername);
        closeStudentVideo.click();
      }
    };
    pc.oniceconnectionstatechange = () => {
      console.log('[Admin] iceConnectionState', studentUsername, pc.iceConnectionState);
      try { updateDiagPanelAdmin({ student: studentUsername, signalingState: pc.signalingState, iceConnectionState: pc.iceConnectionState, connectionState: pc.connectionState, iceGatheringState: pc.iceGatheringState }); } catch(_){ }
    };
    pc.onicegatheringstatechange = () => {
      console.log('[Admin] iceGatheringState', studentUsername, pc.iceGatheringState);
      try { updateDiagPanelAdmin({ student: studentUsername, signalingState: pc.signalingState, iceConnectionState: pc.iceConnectionState, connectionState: pc.connectionState, iceGatheringState: pc.iceGatheringState }); } catch(_){ }
    };
    // Additional diagnostics after 3s if no track yet
    setTimeout(() => {
      if (!studentVideoStream || !studentVideoStream.srcObject) {
        try {
          const receivers = pc.getReceivers().map(r => ({ trackKind: r.track && r.track.kind, trackReadyState: r.track && r.track.readyState }));
          console.warn('[Admin] No track received yet for', studentUsername, 'receivers:', receivers, 'signalingState:', pc.signalingState, 'iceConnectionState:', pc.iceConnectionState);
        } catch(e) { console.warn('[Admin] Receiver inspection failed', e); }
      }
    }, 3000);
    // Fallback timer if no track arrives
    setTimeout(() => {
      if (studentVideoStatus && studentVideoStatus.textContent === 'Requesting stream...') {
        console.warn('[Admin] No remote track within 10s for', studentUsername);
        studentVideoStatus.textContent = 'No stream received (timeout)';
      }
    }, 10000);
  }

  socket.on('webrtc-offer-admin', async ({ from, sdp }) => {
    if (!peerConnections[from]) {
      // Create PC without sending a manual request since offer already arrived
      await openStudentVideo(from, true);
    }
    const pc = peerConnections[from];
    if (!pc) {
      console.error('[Admin] No peerConnection after auto-open for', from);
      return;
    }
    try {
      console.log('[Admin] Received offer from', from);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[Admin] Sending answer to', from);
      socket.emit('webrtc-answer-admin',{ studentId: from, sdp: answer });
      // If not connected within 5s, re-request stream to force fresh offer
      setTimeout(() => {
        try {
          if (!pc) return;
          if (pc.connectionState !== 'connected') {
            console.warn('[Admin] Not connected after answer, re-requesting video for', from);
            socket.emit('admin-requests-video', { studentId: from });
          }
        } catch(_) {}
      }, 5000);
    } catch(err){ console.error('Offer handling failed', err); }
  });
  socket.on('webrtc-ice-candidate-admin', async ({ from, candidate }) => {
    const pc = peerConnections[from];
    if (!pc || !candidate) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); console.log('[Admin] Added ICE candidate from', from); } catch(err){ console.error('ICE add failed', err); }
  });
  // Keep legacy handler for safety if element is present early (hide-only)
  closeStudentVideo?.addEventListener('click', hideStudentModal);

  // ---- User List Interaction ----
  userlist?.addEventListener('click', (e) => {
    if (e.target.classList.contains('watch-btn')){
      const u = e.target.dataset.username;
      console.log('[Admin] Watch clicked for', u, 'sharing?', studentsSharing.has(u));
      if (studentsSharing.has(u)) openStudentVideo(u); else tata.info('Not Sharing','Student not sharing');
      return;
    }
    if (e.target.classList.contains('request-cam-btn')){
      const studentId = e.target.dataset.username;
      console.log('[Admin] Requesting camera from', studentId);
      socket.emit('admin-request-camera', { studentId });
      e.target.textContent = 'Request Sent';
      e.target.disabled = true;
      e.target.style.opacity = '0.6';
      try { tata.info('Camera Request', 'Sent to ' + studentId); } catch(_) {}
      return;
    }
    const container = e.target.closest('.stu-list');
    if (!container) return;
    isUserChnage = true;
    const studentName = container.dataset.username;
    const isActive = container.dataset.active === 'true';
    document.querySelectorAll('.stu-list').forEach(el => el.classList.remove('active'));
    container.classList.add('active');
    userCurrent = studentName;
    if (isActive) socket.emit('change-user', studentName); else socket.emit('change-user-inactive', studentName, roomId);
    setTimeout(()=>{ isUserChnage = false; },150);
  });

  // ---- Delete Room ----
  deleteroom?.addEventListener('click', () => {
    if (!roomId) return;
    axios.post('/api/v1/deleteroom',{ id: roomId }).then(res => {
      if (res.data.status === 400){
        tata.info('Room deleted','You deleted the room');
        socket.emit('delete-room', roomId);
        window.location.replace('/');
      } else tata.error('Room deleted','Error deleting room');
    }).catch(()=> tata.error('Room deleted','Network error'));
  });

  // ---- Editor Sync ----
  editor?.on('change', (ed, changeObj) => {
    try {
      if (userCurrent && isUserChnage === false) socket.emit('admindatachang', userCurrent, changeObj);
      if (broadcastEnabled){
        socket.emit('admin-broadcast-change',{ roomId, changeObj });
      }
    } catch(err){ console.error('Emit change failed', err); }
  });
  editor?.on('focus', () => { isUserChnage = false; });

  socket.on('userdochangeToadmin', (changeData, username) => {
    if (username === userCurrent && editor){
      isUserChnage = true;
      editor.replaceRange(changeData.text, changeData.from, changeData.to, 'Broadcast');
      setTimeout(()=>{ isUserChnage = false; },100);
    }
  });

  socket.on('connect', () => {
    socket.emit('admin-page', roomId);
    const toggle = document.getElementById('broadcastToggle');
    toggle?.addEventListener('change', () => {
      broadcastEnabled = toggle.checked;
      socket.emit('admin-broadcast-toggle',{ roomId, enabled: broadcastEnabled });
      if (broadcastEnabled && editor){ socket.emit('admin-broadcast-full',{ roomId, code: editor.getValue() }); }
    });
    socket.on('admin-send-full-code', ({ roomId: reqRoom }) => {
      if (broadcastEnabled && editor){ socket.emit('admin-broadcast-full',{ roomId: reqRoom, code: editor.getValue() }); }
    });
    socket.on('adminsideide', (text, user) => {
      if (user === userCurrent && editor){ isUserChnage = true; editor.setValue(text); setTimeout(()=>{ isUserChnage=false; },100);} });
    socket.on('inactive-user-code', (code, username) => {
      if (username === userCurrent && editor){ isUserChnage = true; editor.setValue(code || '// No code'); setTimeout(()=>{ isUserChnage=false; },100);} });
    socket.on('update', (usernameArr, rId, inactiveUsers=[]) => {
      if (rId !== roomId || !userlist) return;
      userlist.innerHTML='';
      if (usernameArr && usernameArr.length){
        userlist.insertAdjacentHTML('beforeend','<h5 style="color:#4CAF50; margin:10px 0 5px 0; font-size:14px;">Active Members</h5>');
        usernameArr.forEach(u => {
          const sharing = studentsSharing.has(u);
          userlist.insertAdjacentHTML('beforeend', `<div class="stu-list active-user" data-username="${u}" data-active="true">${u} <span style="color:#4CAF50;">●</span><button class="btn btn-sm watch-btn" data-username="${u}" style="margin-left:10px; background:${sharing?'#28a745':'#6c757d'}; color:#fff; padding:2px 6px; font-size:10px; border:none; border-radius:4px; cursor:${sharing?'pointer':'not-allowed'};" ${sharing?'':'disabled'}>${sharing?'Watch':'Not Sharing'}</button><button class="btn btn-sm request-cam-btn" data-username="${u}" style="margin-left:6px; background:#0d6efd; color:#fff; padding:2px 6px; font-size:10px; border:none; border-radius:4px; cursor:pointer; opacity:${sharing?'0.6':'1'};" ${sharing?'disabled':''}>${sharing?'Request Sent':'Request Camera'}</button></div>`);
        });
      }
      if (inactiveUsers && inactiveUsers.length){
        userlist.insertAdjacentHTML('beforeend','<h5 style="color:#ff9800; margin:15px 0 5px 0; font-size:14px;">Inactive Members (Left)</h5>');
        inactiveUsers.forEach(u => {
          userlist.insertAdjacentHTML('beforeend', `<div class="stu-list inactive-user" data-username="${u}" data-active="false" style="opacity:0.7;">${u} <span style="color:#ff9800;">●</span></div>`);
        });
      }
    });
  });

  // Listen for server-side errors in student video flow
  socket.on('student-video-error', (msg) => {
    console.error('[Admin] Student video error:', msg);
    studentVideoStatus.textContent = 'Error: ' + msg;
  });
  // Ack for camera request delivery
  socket.on('admin-request-camera-ack', ({ studentId, delivered, reason }) => {
    console.log('[Admin] Camera request ack', { studentId, delivered, reason });
    const btn = document.querySelector(`.request-cam-btn[data-username="${studentId}"]`);
    if (!btn) return;
    if (delivered) {
      btn.textContent = 'Request Sent';
      btn.disabled = true;
      btn.style.opacity = '0.6';
      try { tata.info('Request Sent', 'Camera request delivered to ' + studentId); } catch(_) {}
    } else {
      btn.textContent = 'Request Camera';
      btn.disabled = false;
      btn.style.opacity = '1';
      try { tata.warn('Request Failed', reason || 'Delivery failed'); } catch(_) {}
    }
  });
  // Listen for student camera request responses
  socket.on('student-camera-response', ({ studentId, accepted }) => {
    console.log('[Admin] student-camera-response', studentId, accepted);
    if (accepted) {
      try { tata.success('Camera Accepted', studentId + ' is turning on camera'); } catch(_) {}
    } else {
      try { tata.warn('Camera Declined', studentId + ' declined request'); } catch(_) {}
      // restore request button
      const btn = document.querySelector(`.request-cam-btn[data-username="${studentId}"]`);
      if (btn){
        btn.textContent = 'Request Camera';
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    }
  });

  // Expose for other scripts if needed
  window.adminState = { roomId }; 
})();

// Robust navigation to the submissions/grading page
const reportBtn = document.querySelector('#report');
if (reportBtn) {
  reportBtn.addEventListener('click', (e) => {
    e.preventDefault();
    
    // Notify students that admin is viewing submissions
    try {
      const roomId = window.location.toString().split('admin/')[1].split('/')[0];
      if (socket && roomId) {
        socket.emit('admin-viewing-submissions', roomId);
      }
    } catch (err) {
      console.error('Failed to emit admin-viewing-submissions:', err);
    }
    
    // Navigate to report page
    try {
      const url = new URL(window.location.href);
      // Ensure we append '/report' exactly once (handles trailing slash)
      const cleanPath = url.pathname.replace(/\/$/, '');
      const target = `${url.origin}${cleanPath}/report`;
      window.location.assign(target);
    } catch (err) {
      console.error('Failed to navigate to report:', err);
      // Fallback: relative navigation
      window.location.assign(window.location.toString().replace(/\/$/, '') + '/report');
    }
  });
}

// ---------------- Proctoring feed (images) ----------------
// Fetches latest images from the proctoring backend and renders them in the admin panel.
// Backend service must be running at http://localhost:3000 and the extension must be posting images.
(function setupProctoringFeed() {
  const FEED_CONTAINER_ID = 'tabalert'; // existing container in admin panel
  // Replace legacy external feed with integrated snapshot viewer
  const API_BASE = ''; // same origin
  const INTERVAL_MS = 60000; // refresh list every 60s
  const ACTIVE_REFRESH_MS = 20000; // active auto-refresh matching capture cadence
  const snapshotPanel = document.getElementById('proctorSnapshotsPanel');
  if (!snapshotPanel) return;
  const filterSel = document.getElementById('snapshotStudentFilter');
  const refreshBtn = document.getElementById('snapshotRefreshBtn');
  const grid = document.getElementById('snapshotGrid');
  const emptyMsg = document.getElementById('snapshotEmpty');

  let currentFilter = '';
  let knownStudents = new Set();

  function renderSnapshots(list){
    if (!grid) return;
    grid.innerHTML='';
    if (!Array.isArray(list) || !list.length){
      if (emptyMsg) emptyMsg.style.display='block';
      return;
    }
    if (emptyMsg) emptyMsg.style.display='none';
    list.forEach(item => {
      const cell = document.createElement('div');
      cell.style.border='1px solid #e0e0e0';
      cell.style.borderRadius='6px';
      cell.style.overflow='hidden';
      cell.style.background='#111';
      cell.style.position='relative';
      cell.style.height='90px';
      // tag by student to allow live event replacement
      if (item && item.studentId) { cell.dataset.studentId = item.studentId; }
      const img = document.createElement('img');
      // cache-bust to ensure latest frame loads
      img.src=item.path + '?v=' + (item.ts || Date.now());
      img.alt= item.ts || '';
      img.style.width='100%';
      img.style.height='100%';
      img.style.objectFit='cover';
      const badge = document.createElement('div');
      badge.textContent=new Date(item.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      badge.style.position='absolute';
      badge.style.bottom='4px';
      badge.style.right='4px';
      badge.style.background='rgba(0,0,0,0.6)';
      badge.style.color='#fff';
      badge.style.fontSize='10px';
      badge.style.padding='2px 4px';
      badge.style.borderRadius='4px';
      cell.appendChild(img);
      cell.appendChild(badge);
      grid.appendChild(cell);
    });
  }

  async function loadStudents(){
    try {
      const res = await axios.get('/api/v1/proctor/snapshots');
      if (!(res.data && Array.isArray(res.data.students))) return;
      const arr = res.data.students;
      // Rebuild options (keeps first "All Students") so counts refresh
      while (filterSel.options.length > 1) filterSel.remove(1);
      knownStudents = new Set();
      arr.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.studentId;
        opt.textContent = s.studentId + ` (${s.count})`;
        filterSel.appendChild(opt);
        knownStudents.add(s.studentId);
      });
    } catch(e){ console.debug('loadStudents failed', e.message); }
  }

  async function loadSnapshots(){
    try {
      if (currentFilter){
        // Specific student: fetch up to 60 images
        const res = await axios.get('/api/v1/proctor/snapshots', { params: { studentId: currentFilter, limit: 60 } });
        renderSnapshots(res.data.snapshots || []);
      } else {
        // All students: fetch each student's recent few snapshots (fan-out)
        const res = await axios.get('/api/v1/proctor/snapshots');
        const students = res.data.students || [];
        const aggregated = [];
        // Fetch ONLY latest snapshot per student to avoid batch flood
        for (const s of students){
          if (!s.studentId) continue;
          try {
            const snapRes = await axios.get('/api/v1/proctor/snapshots', { params: { studentId: s.studentId, limit: 1 } });
            (snapRes.data.snapshots || []).forEach(item => aggregated.push(item));
          } catch(e){ /* ignore individual student errors */ }
        }
        // Sort by timestamp desc
        aggregated.sort((a,b) => b.ts - a.ts);
        renderSnapshots(aggregated);
      }
      // Update last update timestamp
      try {
        const tsEl = document.getElementById('snapshotLastUpdate');
        if (tsEl) tsEl.textContent = '(' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) + ')';
      } catch(_){}
    } catch(e){ console.debug('loadSnapshots failed', e.message); }
  }

  filterSel?.addEventListener('change', () => { currentFilter = filterSel.value; loadSnapshots(); });
  refreshBtn?.addEventListener('click', () => {
    if (!refreshBtn) return;
    console.log('[Admin] Snapshot refresh button clicked');
    const originalText = refreshBtn.textContent;
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing…';
    Promise.resolve()
      .then(() => loadStudents())
      .then(() => loadSnapshots())
      .finally(() => {
        refreshBtn.disabled = false;
        refreshBtn.textContent = originalText;
      });
  });

  // Socket live updates
  const socket = window.socket || io();
  let lastSnapshotEventTs = 0;
  let lastSnapshotRenderCount = 0;
  socket.on('proctor-snapshot-added', ({ studentId, path, ts }) => {
    try { console.log('[Admin] proctor-snapshot-added', { studentId, path, ts }); } catch(_) {}
    // update student list
    if (studentId && !knownStudents.has(studentId)){
      const opt = document.createElement('option');
      opt.value = studentId;
      opt.textContent = studentId;
      filterSel.appendChild(opt);
      knownStudents.add(studentId);
    }
    // if filter matches or all, prepend
    if (!currentFilter || currentFilter === studentId){
      if (emptyMsg) emptyMsg.style.display='none';
      const cell = document.createElement('div');
      cell.style.border='1px solid #e0e0e0';
      cell.style.borderRadius='6px';
      cell.style.overflow='hidden';
      cell.style.background='#111';
      cell.style.position='relative';
      cell.style.height='90px';
      const img = document.createElement('img');
      img.src=path + '?v=' + (ts || Date.now());
      img.alt= ts || '';
      img.style.width='100%';
      img.style.height='100%';
      img.style.objectFit='cover';
      const badge = document.createElement('div');
      badge.textContent=new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      badge.style.position='absolute';
      badge.style.bottom='4px';
      badge.style.right='4px';
      badge.style.background='rgba(0,0,0,0.6)';
      badge.style.color='#fff';
      badge.style.fontSize='10px';
      badge.style.padding='2px 4px';
      badge.style.borderRadius='4px';
      cell.appendChild(img);
      cell.appendChild(badge);
      // If showing All Students and a cell already exists for this student, replace its image instead of adding duplicate
      if (!currentFilter) {
        const existing = Array.from(grid.children).find(ch => ch.dataset && ch.dataset.studentId === studentId);
        if (existing) {
          const existingImg = existing.querySelector('img');
          if (existingImg) existingImg.src = path + '?v=' + (ts || Date.now());
          const existingBadge = existing.querySelector('div');
          if (existingBadge) existingBadge.textContent = new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        } else {
          cell.dataset.studentId = studentId;
          if (grid.firstChild) grid.insertBefore(cell, grid.firstChild); else grid.appendChild(cell);
        }
      } else {
        if (grid.firstChild) grid.insertBefore(cell, grid.firstChild); else grid.appendChild(cell);
      }
      // trim excess
      const maxCells = 120;
      while (grid.children.length > maxCells) grid.removeChild(grid.lastChild);
      // Auto scroll to top to reveal newest
      try { grid.parentElement && (grid.parentElement.scrollTop = 0); } catch(_) {}
      lastSnapshotEventTs = Date.now();
      lastSnapshotRenderCount++;
      // bump last update indicator when live event arrives
      try { const tsEl = document.getElementById('snapshotLastUpdate'); if (tsEl) tsEl.textContent = '(' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) + ')'; } catch(_){ }
    }
  });

  // Initial load
  loadStudents().then(loadSnapshots);
  setInterval(() => { loadStudents(); loadSnapshots(); }, INTERVAL_MS);
  // Remove high-frequency full reload; rely on socket events for immediacy. Keep occasional student list refresh.

  // Fallback: if no live events for >90s but student is sharing camera, force refresh every 30s
  setInterval(() => {
    const now = Date.now();
    if (now - lastSnapshotEventTs > 90000) {
      try { console.log('[Admin] Fallback snapshot refresh (no live events in >90s)'); } catch(_) {}
      loadStudents();
      loadSnapshots();
    }
  }, 30000);
})();
