var express = require('express');
var bodyParser = require('body-parser'); // parse incoming request
var path = require('path'); //handling file paths
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const mongoose = require('mongoose');
var indexRouter = require('./routes/index');
const api = require('./routes/api');
const rooomRouter = require('./routes/room');
require('dotenv').config({ path: path.join(__dirname, '.env') });
// expose selected env to templates
const exposeToViews = {
  JUDGE0_API_KEY: process.env.JUDGE0_API_KEY || '',
  // Allow configuring WebRTC ICE servers via env (JSON array or single url)
  WEBRTC_ICE_SERVERS: (() => {
    try {
      if (process.env.WEBRTC_ICE_SERVERS) {
        // Accept either JSON string or a simple URL string
        const v = process.env.WEBRTC_ICE_SERVERS.trim();
        if (v.startsWith('[')) return JSON.parse(v);
        return [{ urls: [v] }];
      }
    } catch (_) {}
    // Default to public Google STUN
    return [{ urls: ['stun:stun.l.google.com:19302'] }];
  })()
};
// Optional: force TURN-only relaying (set WEBRTC_FORCE_TURN=true)
exposeToViews.WEBRTC_FORCE_TURN = String(process.env.WEBRTC_FORCE_TURN).toLowerCase() === 'true';
let PORT = process.env.PORT || 3001;
let HOST = (process.env.HOST || '').trim(); // empty means use Node default (:: if available)
var app = express();   // instance of the Express application

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// make variables available to all ejs views
app.use((req, res, next) => {
  Object.assign(res.locals, exposeToViews);
  next();
});

app.use('/', indexRouter);  //Handles requests for the root URL.
app.use('/api/v1', api);
app.use('/room', rooomRouter);

app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});
let server;
if (HOST) {
  server = app.listen(PORT, HOST, () => {
    const shownHost = (HOST === '0.0.0.0' || HOST === '::') ? 'localhost' : HOST;
    console.log(`Server connecter: ${PORT}`);
    console.log(`HTTP ready at http://${shownHost}:${PORT}/`);
  });
} else {
  // No host provided: allow Node to pick dual-stack ("::" on IPv6-capable systems)
  server = app.listen(PORT, () => {
    console.log(`Server connecter: ${PORT}`);
    console.log(`HTTP ready at http://localhost:${PORT}/`);
  });
}

// Basic health endpoint for diagnostics
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', port: PORT, time: new Date().toISOString() });
});

// Global error handlers to see why process might exit
process.on('uncaughtException', (err) => {
  console.error('[Fatal] uncaughtException:', err.stack || err.message);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fatal] unhandledRejection:', reason);
});

// MongoDB setup

mongoose
  .connect(process.env.MONGO_DB_URI)
  .then(() => console.log('DB CONNECTION SUCCESSFULL !'))
  .catch((err) => {
    console.log('DB connection failed:', err.message);
  });

//initialize socket for the server

const socketServe = require('./socketio');
const io = socketServe.sock(server);

// Snapshot / Proctoring endpoints (extension compatibility + API)
const fs = require('fs');

// Allow large base64 payloads (approx < 5MB per image)
app.post('/upload-image', express.json({ limit: '6mb' }), (req, res) => {
  const { userid, image } = req.body || {};
  if (!userid || !image || typeof image !== 'string') {
    return res.status(400).json({ error: 'userid and image data URL required', interval: 20000 });
  }
  // Expect data URL like data:image/png;base64,xxxx
  const match = image.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid image data URL', interval: 20000 });
  }
  const ext = match[1] === 'jpeg' ? 'jpg' : 'png';
  const b64 = match[2];
   // Debug log size
  try { console.log('[Snapshot] incoming', userid, 'bytes(base64)=', b64.length); } catch(_) {}
  const ts = Date.now();
  const dir = path.join(__dirname, 'public', 'snapshots', userid);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const filename = ts + '.' + ext;
  const filePath = path.join(dir, filename);
  try {
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
  } catch (e) {
    console.error('Snapshot write failed', e.message);
    return res.status(500).json({ error: 'Failed to save image', interval: 20000 });
  }
  const publicPath = `/snapshots/${userid}/${filename}`;
  // Broadcast to any admin listeners
  if (io && io.emitProctorSnapshot) {
    io.emitProctorSnapshot({ studentId: userid, path: publicPath, ts });
  }
  // Return adjustable next interval (could be dynamic later)
  // Return next capture interval (20s fixed for now)
  return res.status(200).json({ ok: true, interval: 20000, path: publicPath, ts });
});

// Unified API endpoint to list snapshots
app.get('/api/v1/proctor/snapshots', (req, res) => {
  const { studentId, limit } = req.query;
  const baseDir = path.join(__dirname, 'public', 'snapshots');
  const max = Math.min(parseInt(limit || '50', 10) || 50, 200);
  try {
    if (studentId) {
      const dir = path.join(baseDir, studentId);
      if (!fs.existsSync(dir)) return res.status(200).json({ snapshots: [] });
      const files = fs.readdirSync(dir).filter(f => /\.(png|jpg)$/.test(f));
      const items = files.map(f => ({ path: `/snapshots/${studentId}/${f}`, ts: Number(f.split('.')[0]) || null }))
        .sort((a,b) => b.ts - a.ts)
        .slice(0, max);
      return res.status(200).json({ snapshots: items });
    }
    // List all students (top-level dirs)
    if (!fs.existsSync(baseDir)) return res.status(200).json({ students: [] });
    const dirs = fs.readdirSync(baseDir).filter(name => {
      try { return fs.statSync(path.join(baseDir, name)).isDirectory(); } catch(_) { return false; }
    });
    const result = dirs.map(student => {
      const studentDir = path.join(baseDir, student);
      const files = fs.readdirSync(studentDir).filter(f => /\.(png|jpg)$/.test(f));
      const latest = files.sort((a,b) => b.localeCompare(a))[0];
      return {
        studentId: student,
        count: files.length,
        latest: latest ? `/snapshots/${student}/${latest}` : null,
      };
    });
    return res.status(200).json({ students: result });
  } catch (e) {
    console.error('List snapshots failed', e.message);
    return res.status(500).json({ error: 'Failed to list snapshots' });
  }
});