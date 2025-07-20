// server.js
const express = require('express');
const { MapArtDatabase } = require('./database.js');

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

const PORT = 4000;
const db = new MapArtDatabase();

// Endpoint for a bot to request a job
app.post('/api/jobs/request', (req, res) => {
    const { botId } = req.body;
    if (!botId) {
        return res.status(400).json({ error: 'botId is required' });
    }

    try {
        const job = db.getAvailableJob(botId);
        if (job) {
            console.log(`Assigned ${job.type} (ID: ${job.jobId}) to bot ${botId}`);
            res.json(job);
        } else {
            res.json({ message: 'No jobs available at the moment.' });
        }
    } catch (error) {
        console.error("Error getting job:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint for a bot to report a job as complete
app.post('/api/jobs/complete', (req, res) => {
    const { jobId, jobType } = req.body;
    if (!jobId || !jobType) {
        return res.status(400).json({ error: 'jobId and jobType are required' });
    }
    
    try {
        db.completeJob(jobId, jobType);
        console.log(`Job ${jobId} (${jobType}) marked as completed.`);
        res.json({ success: true, message: `Job ${jobId} marked as complete.` });
    } catch (error) {
        console.error("Error completing job:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`MapArt API Server listening on port ${PORT}`);
    console.log('Ensure you have run the add_mapart.js script to populate the database.');
});