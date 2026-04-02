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
    logs.unshift(`[${timestamp}] ${message}`);
    if (logs.length > 50) logs.pop();
}

const s3Client = new S3Client({
    endpoint: "https://s3.us-east-005.backblazeb2.com", // Change if your region is different
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
    addLog(`🧹 Cleaning & Mirroring ${quality}...`);
    try {
        const playlistRes = await axios.get(url);
        const originalText = playlistRes.data;

        const lines = originalText.split('\n');
        const cleanedLines = [];
        const segmentsToDownload = [];

        // --- AGGRESSIVE CLEANING ---
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                cleanedLines.push(trimmed);
                continue;
            }
            // Strip everything except the filename (e.g. segment0.ts)
            const fileNameOnly = trimmed.split('?')[0].split('/').pop();
            cleanedLines.push(fileNameOnly);

            // Get the real download URL
            const fullUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, url).href;
            segmentsToDownload.push({ name: fileNameOnly, url: fullUrl });
        }

        // Upload Clean Playlist
        await uploadToB2(`${videoId}/${quality}/index.m3u8`, cleanedLines.join('\n'), 'application/x-mpegURL');

        // Download & Upload Segments (Parallel for Speed)
        const CONCURRENCY = 5; 
        for (let i = 0; i < segmentsToDownload.length; i += CONCURRENCY) {
            const chunk = segmentsToDownload.slice(i, i + CONCURRENCY);
            await Promise.all(chunk.map(async (seg) => {
                const res = await axios({ method: 'get', url: seg.url, responseType: 'stream' });
                await uploadToB2(`${videoId}/${quality}/${seg.name}`, res.data, 'video/MP2T');
            }));
            if (i % 20 === 0) addLog(`Progress ${quality}: ${i}/${segmentsToDownload.length}`);
        }
        addLog(`✅ ${quality} Mirror Finished.`);
    } catch (err) { addLog(`❌ Error in ${quality}: ${err.message}`); }
}

async function createMasterPlaylist(videoData, videoId) {
    let master = "#EXTM3U\n#EXT-X-VERSION:3\n\n";
    for (const quality of Object.keys(videoData.fast_stream_url)) {
        let res = quality === "1080p" ? "1920x1080" : quality === "720p" ? "1280x720" : "854x480";
        master += `#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=${res}\n${quality}/index.m3u8\n\n`;
    }
    await uploadToB2(`${videoId}/master.m3u8`, master, 'application/x-mpegURL');
}

app.get('/', (req, res) => {
    res.send(`<html><body style="background:#000;color:#0f0;font-family:monospace;padding:20px;">
        <h2>B2 Mirror Live Logs</h2><div style="border:1px solid #333;padding:10px;">${logs.map(l => `<div>${l}</div>`).join('')}</div>
    </body></html>`);
});

app.post('/mirror', async (req, res) => {
    const { videoData, videoId } = req.body;
    res.json({ message: "Started mirroring", videoId });
    (async () => {
        for (const [q, url] of Object.entries(videoData.fast_stream_url)) { await mirrorHLS(q, url, videoId); }
        await createMasterPlaylist(videoData, videoId);
        addLog(`✨ ALL JOBS FINISHED: ${videoId}`);
    })();
});

app.listen(PORT, () => console.log(`Mirror on ${PORT}`));
