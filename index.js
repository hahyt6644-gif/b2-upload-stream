const express = require('express');
const axios = require('axios');
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
let logs = []; // Simple array to store recent logs for the web view

// Helper to push logs to our web console
function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${message}`;
    console.log(entry);
    logs.unshift(entry); // Add to start of array
    if (logs.length > 50) logs.pop(); // Keep only last 50 logs
}

const s3Client = new S3Client({
    endpoint: "https://s3.us-east-005.backblazeb2.com",
    region: "us-east-005",
    credentials: {
        accessKeyId: process.env.B2_KEY_ID, 
        secretAccessKey: process.env.B2_APP_KEY,
    },
});

async function uploadToB2(key, body, contentType) {
    const upload = new Upload({
        client: s3Client,
        params: { 
            Bucket: "tera-stream-itz", 
            Key: key, 
            Body: body, 
            ContentType: contentType 
        },
    });
    return upload.done();
}

async function mirrorHLS(quality, url, videoId) {
    addLog(`Starting ${quality} download...`);
    try {
        const playlistRes = await axios.get(url);
        const playlistText = playlistRes.data;

        // Upload index file
        await uploadToB2(`${videoId}/${quality}/index.m3u8`, playlistText, 'application/x-mpegURL');
        addLog(`Uploaded ${quality}/index.m3u8`);

        const segments = playlistText.match(/.*\.ts/g);
        if (segments) {
            addLog(`Found ${segments.length} segments for ${quality}`);
            for (let i = 0; i < segments.length; i++) {
                const segmentLine = segments[i];
                // FIX: Strip tokens from filename to avoid "1024 bytes" error
                const cleanFileName = segmentLine.split('?')[0].split('/').pop();
                const segmentUrl = new URL(segmentLine, url).href;

                const segmentStream = await axios({ method: 'get', url: segmentUrl, responseType: 'stream' });
                await uploadToB2(`${videoId}/${quality}/${cleanFileName}`, segmentStream.data, 'video/MP2T');
                
                if (i % 5 === 0) addLog(`Progress ${quality}: ${i + 1}/${segments.length}`);
            }
            addLog(`✅ ${quality} Complete!`);
        }
    } catch (err) {
        addLog(`❌ Error in ${quality}: ${err.message}`);
    }
}

// WEB CONSOLE PAGE
app.get('/', (req, res) => {
    const logHtml = logs.map(l => `<div>${l}</div>`).join('');
    res.send(`
        <html>
            <head>
                <title>B2 Mirror Console</title>
                <meta http-equiv="refresh" content="5">
                <style>
                    body { background: #121212; color: #00ff00; font-family: monospace; padding: 20px; }
                    h2 { color: #fff; }
                    .console { border: 1px solid #333; padding: 10px; height: 400px; overflow-y: auto; background: #000; }
                </style>
            </head>
            <body>
                <h2>B2 Stream Mirror - Live Logs</h2>
                <p>Status: Online | Auto-refreshing every 5s</p>
                <div class="console">${logHtml || "Waiting for logs..." }</div>
            </body>
        </html>
    `);
});

// API ENDPOINT
app.post('/mirror', async (req, res) => {
    const { videoData, videoId } = req.body;
    if (!videoData || !videoId) return res.status(400).json({ error: "Missing data" });

    res.json({ message: "Mirroring started in background", videoId });

    // Processing in background
    (async () => {
        for (const [quality, url] of Object.entries(videoData.fast_stream_url)) {
            await mirrorHLS(quality, url, videoId);
        }
        addLog(`🏁 ALL JOBS FINISHED FOR ${videoId}`);
    })();
});

app.listen(PORT, () => addLog(`Server started on port ${PORT}`));
