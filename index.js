const axios = require('axios');
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

// 1. Initialize B2 Client
const s3Client = new S3Client({
    endpoint: "https://s3.us-east-005.backblazeb2.com",
    region: "us-east-005",
    credentials: {
        accessKeyId: process.env.B2_KEY_ID, 
        secretAccessKey: process.env.B2_APP_KEY,
    },
});

async function mirrorHLS(quality, url, videoId) {
    console.log(`Mirroring ${quality} to B2...`);
    
    // A. Get the playlist text
    const playlistRes = await axios.get(url);
    const playlistText = playlistRes.data;

    // B. Upload the .m3u8 file itself
    await uploadToB2(`${videoId}/${quality}/index.m3u8`, playlistText, 'application/x-mpegURL');

    // C. Find all segments (.ts files) in the text
    // This simple regex finds lines ending in .ts
    const segments = playlistText.match(/.*\.ts/g);
    
    if (segments) {
        for (const segmentName of segments) {
            // Construct the full URL for the segment
            // Note: This assumes segments are relative to the .m3u8 URL
            const segmentUrl = new URL(segmentName, url).href;
            
            // D. Pipe the segment directly to B2
            const segmentStream = await axios({ method: 'get', url: segmentUrl, responseType: 'stream' });
            await uploadToB2(`${videoId}/${quality}/${segmentName}`, segmentStream.data, 'video/MP2T');
            console.log(`Uploaded segment: ${segmentName}`);
        }
    }
}

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

// 3. The Logic to process your JSON
const videoData = { /* PASTE YOUR JSON LIST[0] HERE */ };
const videoId = "Update_20231215"; // Unique ID for the folder

async function startMirroring() {
    for (const [quality, url] of Object.entries(videoData.fast_stream_url)) {
        await mirrorHLS(quality, url, videoId);
    }
    console.log("✅ All qualities mirrored to B2!");
}

startMirroring();
                                                      
