const express = require('express');
const axios = require('axios');
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
let logs = [];

function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${message}`;
    console.log(entry);
    logs.unshift(entry);
    if (logs.length > 50) logs.pop();
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
        params: { Bucket: "tera-stream-itz", Key: key, Body: body, ContentType: contentType },
    });
    return upload.done();
}

async function mirrorHLS(quality, url, videoId) {
    addLog(`Processing ${quality}...`);
    try {
        const playlistRes = await axios.get(url);
        const originalText = playlistRes.data;

        // --- THE SKIPPING FIX ---
        // We rewrite the playlist to use ONLY filenames.
        // This makes VLC/Players attach the token to every segment automatically.
        const lines = originalText.split('\n');
        const cleanedLines = lines.map(line => {
            if (line.trim().endsWith('.ts') || line.includes('.ts?')) {
                return line.split('?')[0].split('/').pop(); 
            }
            return line;
        });
        const fixedPlaylist = cleanedLines.join('\n');

        await uploadToB2(`${videoId}/${quality}/index.m3u8`, fixedPlaylist, 'application/x-mpegURL');

        // Download segments using original URLs
        const segments = originalText.match(/.*\.ts/g);
        if (segments) {
            for (let i = 0; i < segments.length; i++) {
                const segmentLine = segments[i];
                const cleanFileName = segmentLine.split('?')[0].split('/').pop();
                const segmentUrl = new URL(segmentLine, url).href;

                const segmentStream = await axios({ method: 'get', url: segmentUrl, responseType: 'stream' });
                await uploadToB2(`${videoId}/${quality}/${cleanFileName}`, segmentStream.data, 'video/MP2T');
                
                if (i % 10 === 0) addLog(`Progress ${quality}: ${i + 1}/${segments.length}`);
            }
            addLog(`✅ ${quality} Complete.`);
        }
    } catch (err) {
        addLog(`❌ Error in ${quality}: ${err.message}`);
    }
}

async function createMasterPlaylist(videoData, videoId) {
    addLog("Generating Master Playlist...");
    let master = "#EXTM3U\n#EXT-X-VERSION:3\n\n";
    
    for (const quality of Object.keys(videoData.fast_stream_url)) {
        let res = quality === "1080p" ? "1920x1080" : quality === "720p" ? "1280x720" : "854x480";
        let bw = quality === "1080p" ? "5000000" : quality === "720p" ? "2800000" : "1400000";
        
        master += `#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${res}\n`;
        master += `${quality}/index.m3u8\n\n`; // Relative path to sub-playlist
    }

    await uploadToB2(`${videoId}/master.m3u8`, master, 'application/x-mpegURL');
}

app.get('/', (req, res) => {
    const logHtml = logs.map(l => `<div>${l}</div>`).join('');
    res.send(`<html><body style="background:#121212;color:#0f0;font-family:monospace;padding:20px;">
        <h2>B2 Mirror Live Logs</h2><meta http-equiv="refresh" content="5">
        <div style="background:#000;padding:10px;height:450px;overflow-y:auto;border:1px solid #333;">${logHtml || "Waiting for task..."}</div>
    </body></html>`);
});

app.post('/mirror', async (req, res) => {
    const { videoData, videoId } = req.body;
    res.json({ message: "Mirroring started", videoId });
    
    (async () => {
        for (const [quality, url] of Object.entries(videoData.fast_stream_url)) {
            await mirrorHLS(quality, url, videoId);
        }
        await createMasterPlaylist(videoData, videoId);
        addLog(`✨ ALL JOBS FINISHED: ${videoId}`);
    })();
});

app.listen(PORT, () => console.log(`Server on ${PORT}`));
