const { OpenAI } = require('openai');
const https = require('https');
const { put } = require('@vercel/blob');
const { Receiver } = require('@upstash/qstash');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.BlumaAPI
});

// Initialize QStash receiver for signature verification
const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
});

// Helper function to post to Slack response_url
function postToSlack(url, body) {
  return new Promise((resolve, reject) => {
    console.log('[worker] Posting message to Slack...');
    const bodyString = JSON.stringify(body);
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log(`[worker] Slack response status: ${res.statusCode}`);
        resolve();
      });
    });

    req.on('error', (e) => {
      console.error('[worker] Error posting to Slack:', e);
      reject(e);
    });

    req.write(bodyString);
    req.end();
  });
}

// Generate video with user's exact prompt
async function generateVideo(prompt, response_url) {
  let generationId;

  try {
    // 1. Create the video generation job
    console.log('[worker] Calling OpenAI Videos API to start generation...');
    console.log('[worker] User prompt:', prompt);
    
    const createResponse = await fetch('https://api.openai.com/v1/videos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.BlumaAPI}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: prompt,
        model: 'sora-2',
        size: '720x1280',
        seconds: '4'
      })
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create video job: ${createResponse.status} ${errorText}`);
    }

    const videoJob = await createResponse.json();
    generationId = videoJob.id;
    console.log(`[worker] Video job created successfully. ID: ${generationId}`);

    // 2. Poll for completion
    const maxAttempts = 180; // Poll for up to 15 minutes
    const pollInterval = 5000; // 5 seconds
    let attempt = 0;

    while (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      attempt++;
      console.log(`[worker] Polling attempt ${attempt}/${maxAttempts} for video ID: ${generationId}`);

      const statusResponse = await fetch(`https://api.openai.com/v1/videos/${generationId}`, {
        headers: { 'Authorization': `Bearer ${process.env.BlumaAPI}` }
      });

      if (!statusResponse.ok) {
        console.warn(`[worker] Status check failed (attempt ${attempt}): ${statusResponse.status}`);
        continue;
      }

      const statusData = await statusResponse.json();
      console.log(`[worker] Current video status: ${statusData.status}`);

      if (statusData.status === 'completed') {
        console.log(`[worker] Video completed! Now downloading from OpenAI...`);

        // Download the video content from OpenAI
        const videoContentResponse = await fetch(`https://api.openai.com/v1/videos/${generationId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.BlumaAPI}` }
        });

        if (!videoContentResponse.ok) {
          throw new Error(`Failed to download video content from OpenAI: ${videoContentResponse.status}`);
        }
        
        const videoBlob = await videoContentResponse.blob();
        console.log(`[worker] Video downloaded from OpenAI. Size: ${videoBlob.size} bytes.`);

        // Upload to Vercel Blob
        const filename = `bluma-video-${generationId}.mp4`;
        console.log(`[worker] Uploading video to Vercel Blob as ${filename}...`);
        
        const { url: publicUrl } = await put(filename, videoBlob, {
          access: 'public',
          contentType: 'video/mp4',
        });
        console.log(`[worker] Video uploaded to Vercel Blob. Public URL: ${publicUrl}`);

        // Notify user that video is ready with the video ID
        await postToSlack(response_url, {
          response_type: 'in_channel',
          text: `✅ *Video generation complete!*\n\n*Video ID:* \`${generationId}\`\n\nTo view your video, use:\n\`/bluma-bot get video ${generationId}\``
        });
        return; // Success
      }

      if (statusData.status === 'failed' || statusData.status === 'error') {
        throw new Error(`Video generation failed: ${statusData.error?.message || 'Unknown error'}`);
      }
    }
    
    throw new Error('Video generation timed out after 15 minutes.');

  } catch (error) {
    console.error('[worker] An error occurred during video generation:', error);
    await postToSlack(response_url, {
      response_type: 'in_channel',
      text: `❌ *Video Generation Failed*\n\n*Reason:* ${error.message}`
    });
  }
}

// Main handler for QStash worker
module.exports = async (req, res) => {
  try {
    console.log('[worker] Received request from QStash');
    
    // Verify the request is from QStash
    const signature = req.headers['upstash-signature'];
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk.toString());
      req.on('end', () => resolve(data));
      req.on('error', err => reject(err));
    });

    console.log('[worker] Verifying QStash signature...');
    const isValid = await receiver.verify({
      signature,
      body,
    });

    if (!isValid) {
      console.error('[worker] Invalid QStash signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[worker] QStash signature verified');

    // Parse the job data
    const { prompt, response_url } = JSON.parse(body);
    console.log('[worker] Job data:', { prompt, response_url: response_url.substring(0, 50) + '...' });

    // Process the video generation (DON'T respond until it's done)
    console.log('[worker] Starting video generation...');
    await generateVideo(prompt, response_url);
    console.log('[worker] Video generation completed');
    
    // NOW respond to QStash (after everything is done)
    res.status(200).json({ status: 'completed' });
    console.log('[worker] Acknowledged QStash request with completion status');

  } catch (error) {
    console.error('[worker] Error processing video:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
};

